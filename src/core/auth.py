"""Supabase JWT validation and session-isolated user authentication."""
import json
import ssl
from typing import Optional
from urllib.request import Request, urlopen
from functools import lru_cache
from fastapi import Header, Query, HTTPException

try:
    import certifi
    HAS_CERTIFI = True
except ImportError:
    HAS_CERTIFI = False

try:
    import jwt
    from jwt import PyJWKClient
    HAS_JWT = True
except ImportError:
    jwt = None
    PyJWKClient = None
    HAS_JWT = False

from src.config.settings import settings
from src.core.logging import user_id_ctx, logger
from src.core.security import normalize_user_id

DEFAULT_LOCAL_USER = settings.DEFAULT_LOCAL_USER
DEFAULT_GUEST_USER = DEFAULT_LOCAL_USER


def get_ssl_context() -> ssl.SSLContext:
    """Builds a secure SSL context with certifi or system certificates."""
    if HAS_CERTIFI:
        try:
            return ssl.create_default_context(cafile=certifi.where())
        except Exception:
            pass
    try:
        return ssl.create_default_context()
    except Exception:
        return ssl._create_unverified_context()


def set_current_user(user_id: str):
    """Sets current user ID in the execution context for logging and request scoping."""
    norm = normalize_user_id(user_id)
    user_id_ctx.set(norm)
    return norm


def get_current_user() -> str:
    """Retrieves current user ID from context, defaulting to local user ID."""
    uid = user_id_ctx.get()
    return uid if uid else DEFAULT_LOCAL_USER


@lru_cache(maxsize=1)
def jwks_client() -> Optional[PyJWKClient]:
    """Returns singleton JWKS client for Supabase token verification."""
    if not settings.SUPABASE_URL or not HAS_JWT:
        return None
    return PyJWKClient(f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/.well-known/jwks.json")


def require_user(
    authorization: Optional[str] = Header(default=None),
    x_guest_id: Optional[str] = Header(default=None, alias="X-Guest-Id"),
    token_param: Optional[str] = Query(default=None, alias="token"),
    guest_id_param: Optional[str] = Query(default=None, alias="guest_id"),
    user_id_param: Optional[str] = Query(default=None, alias="user_id"),
) -> str:
    """Validates Supabase JWT or defaults to session-isolated guest or local user."""
    raw_token = None
    if authorization and authorization.startswith("Bearer "):
        raw_token = authorization.removeprefix("Bearer ").strip()
    elif token_param:
        raw_token = token_param.strip()

    # 1. Validate JWT Token if provided
    if raw_token and raw_token not in ("null", "undefined", "", "guest", "local") and not raw_token.startswith("guest_"):
        # Fast path: JWKS cryptographic signature verification
        client = jwks_client()
        if client and HAS_JWT:
            try:
                key = client.get_signing_key_from_jwt(raw_token).key
                claims = jwt.decode(
                    raw_token,
                    key,
                    algorithms=["RS256", "ES256"],
                    options={"verify_aud": False},
                )
                user_id = claims.get("sub")
                if user_id:
                    set_current_user(user_id)
                    return user_id
            except Exception as e:
                logger.debug(f"JWKS verification notice: {e}")

        # Fallback: Supabase Auth REST verification
        if settings.SUPABASE_URL and settings.SUPABASE_PUBLISHABLE_KEY:
            try:
                req = Request(
                    f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/user",
                    headers={
                        "apikey": settings.SUPABASE_PUBLISHABLE_KEY,
                        "Authorization": f"Bearer {raw_token}",
                    },
                )
                with urlopen(req, context=get_ssl_context(), timeout=5.0) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    user_id = data.get("id")
                    if user_id:
                        set_current_user(user_id)
                        return user_id
            except Exception as e:
                logger.debug(f"Supabase REST auth notice: {e}")

        raise HTTPException(status_code=401, detail="Invalid or expired access token")
    elif raw_token and raw_token.startswith("guest_"):
        set_current_user(raw_token)
        return raw_token

    # 2. Ephemeral Guest Session ID from header or query param
    guest = x_guest_id or guest_id_param or user_id_param
    if guest and (guest.startswith("guest_") or len(guest) >= 8):
        cleaned_guest = guest.strip()
        set_current_user(cleaned_guest)
        return cleaned_guest

    set_current_user(DEFAULT_LOCAL_USER)
    return DEFAULT_LOCAL_USER
