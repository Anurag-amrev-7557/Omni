"""Supabase JWT validation for Render API requests."""
import os
import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from contextvars import ContextVar
from functools import lru_cache
import jwt
from fastapi import Header, HTTPException
from jwt import PyJWKClient

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_PUBLISHABLE_KEY = os.getenv("SUPABASE_PUBLISHABLE_KEY")
current_user_id: ContextVar[str | None] = ContextVar("current_user_id", default=None)

def set_current_user(user_id: str):
    return current_user_id.set(user_id)

def get_current_user() -> str:
    user_id = current_user_id.get()
    if not user_id:
        raise RuntimeError("No authenticated user context")
    return user_id

@lru_cache(maxsize=1)
def jwks_client():
    if not SUPABASE_URL:
        raise HTTPException(status_code=503, detail="SUPABASE_URL is not configured")
    return PyJWKClient(f"{SUPABASE_URL.rstrip('/')}/auth/v1/.well-known/jwks.json")

DEFAULT_GUEST_USER = "00000000-0000-0000-0000-000000000000"
DEFAULT_LOCAL_USER = "10d2f529-3fae-4a29-9a5e-312876700ff9"

def require_user(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        return DEFAULT_LOCAL_USER if not SUPABASE_URL else DEFAULT_GUEST_USER
    token = authorization.removeprefix("Bearer ").strip()
    if not token or token in ("null", "undefined", ""):
        return DEFAULT_LOCAL_USER if not SUPABASE_URL else DEFAULT_GUEST_USER
    if not SUPABASE_URL:
        return DEFAULT_LOCAL_USER
    try:
        key = jwks_client().get_signing_key_from_jwt(token).key
        claims = jwt.decode(token, key, algorithms=["RS256", "ES256"], audience="authenticated")
        user_id = claims.get("sub")
        if not user_id:
            raise ValueError("Missing subject")
        return user_id
    except Exception:
        # Older Supabase projects can still use HS256 tokens, which do not
        # expose a public JWKS key. Ask Supabase Auth to validate those tokens
        # instead of trusting unverified JWT claims.
        if not SUPABASE_URL or not SUPABASE_PUBLISHABLE_KEY:
            raise HTTPException(status_code=401, detail="Invalid access token or missing Supabase verifier configuration")
        try:
            request = Request(
                f"{SUPABASE_URL.rstrip('/')}/auth/v1/user",
                headers={"apikey": SUPABASE_PUBLISHABLE_KEY, "Authorization": f"Bearer {token}"},
            )
            with urlopen(request, timeout=5) as response:
                user_id = json.loads(response.read()).get("id")
            if not user_id:
                raise ValueError("Missing user id")
            return user_id
        except (HTTPError, URLError, ValueError, json.JSONDecodeError):
            raise HTTPException(status_code=401, detail="Invalid or expired access token")
