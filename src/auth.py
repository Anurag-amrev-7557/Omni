"""Supabase JWT validation for Render API requests."""
import os
from functools import lru_cache
import jwt
from fastapi import Header, HTTPException
from jwt import PyJWKClient

SUPABASE_URL = os.getenv("SUPABASE_URL")

@lru_cache(maxsize=1)
def jwks_client():
    if not SUPABASE_URL:
        raise HTTPException(status_code=503, detail="SUPABASE_URL is not configured")
    return PyJWKClient(f"{SUPABASE_URL.rstrip('/')}/auth/v1/.well-known/jwks.json")

def require_user(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        key = jwks_client().get_signing_key_from_jwt(token).key
        claims = jwt.decode(token, key, algorithms=["RS256", "ES256"], audience="authenticated")
        user_id = claims.get("sub")
        if not user_id:
            raise ValueError("Missing subject")
        return user_id
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired access token")
