"""Supabase JWT validation for Render API requests."""
import os
import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from contextvars import ContextVar
from functools import lru_cache
from fastapi import Header, Query, HTTPException
try:
    import jwt
    from jwt import PyJWKClient
    HAS_JWT = True
except ImportError:
    jwt = None
    PyJWKClient = None
    HAS_JWT = False

try:
    from src.config import SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY
except ImportError:
    try:
        from config import SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY
    except ImportError:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
        SUPABASE_URL = os.getenv("SUPABASE_URL", "")
        SUPABASE_PUBLISHABLE_KEY = os.getenv("SUPABASE_PUBLISHABLE_KEY", "")

current_user_id: ContextVar[str | None] = ContextVar("current_user_id", default=None)

def set_current_user(user_id: str):
    return current_user_id.set(user_id)

def get_current_user() -> str:
    user_id = current_user_id.get()
    if not user_id:
        return DEFAULT_LOCAL_USER
    return user_id

@lru_cache(maxsize=1)
def jwks_client():
    if not SUPABASE_URL:
        raise HTTPException(status_code=503, detail="SUPABASE_URL is not configured")
    return PyJWKClient(f"{SUPABASE_URL.rstrip('/')}/auth/v1/.well-known/jwks.json")

def _get_ssl_context():
    import ssl
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        pass
    try:
        return ssl.create_default_context()
    except Exception:
        return ssl._create_unverified_context()

DEFAULT_LOCAL_USER = "10d2f529-3fae-4a29-9a5e-312876700ff9"
DEFAULT_GUEST_USER = DEFAULT_LOCAL_USER

def require_user(
    authorization: str | None = Header(default=None),
    x_guest_id: str | None = Header(default=None, alias="X-Guest-Id"),
    token_param: str | None = Query(default=None, alias="token"),
    guest_id_param: str | None = Query(default=None, alias="guest_id"),
    user_id_param: str | None = Query(default=None, alias="user_id"),
) -> str:
    """Validates Supabase JWT or defaults to session-isolated guest or local user."""
    # 1. Check token from authorization header or query parameter (used by <img> tags and downloads)
    raw_token = None
    if authorization and authorization.startswith("Bearer "):
        raw_token = authorization.removeprefix("Bearer ").strip()
    elif token_param:
        raw_token = token_param.strip()

    if raw_token and raw_token not in ("null", "undefined", "", "guest", "local") and not raw_token.startswith("guest_"):
        if SUPABASE_URL and HAS_JWT:
            try:
                key = jwks_client().get_signing_key_from_jwt(raw_token).key
                claims = jwt.decode(
                    raw_token,
                    key,
                    algorithms=["RS256", "ES256"],
                    options={"verify_aud": False},
                )
                user_id = claims.get("sub")
                if user_id:
                    return user_id
            except Exception:
                pass

        if SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY:
            try:
                request = Request(
                    f"{SUPABASE_URL.rstrip('/')}/auth/v1/user",
                    headers={"apikey": SUPABASE_PUBLISHABLE_KEY, "Authorization": f"Bearer {raw_token}"},
                )
                with urlopen(request, context=_get_ssl_context(), timeout=5) as response:
                    user_data = json.loads(response.read())
                    user_id = user_data.get("id")
                if user_id:
                    return user_id
            except Exception:
                pass
        raise HTTPException(status_code=401, detail="Invalid or expired access token")
    elif raw_token and raw_token.startswith("guest_"):
        return raw_token

    # 2. Check guest ID from header or query parameter
    guest = x_guest_id or guest_id_param or user_id_param
    if guest and (guest.startswith("guest_") or len(guest) >= 8):
        return guest.strip()

    return DEFAULT_LOCAL_USER
