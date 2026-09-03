"""Single Authoritative Security and Tenant Isolation Choke Point.

Guarantees that every database, vector search, file system, and graph query
is strictly scoped to the authenticated user or session-isolated guest.
"""
import os
import re
import uuid
from typing import Optional, List
from qdrant_client.models import Filter, FieldCondition, MatchValue, MatchAny
from src.config.settings import settings

_SENTINEL_USERS = {"", "default_user", "local", "guest", "default", "00000000-0000-0000-0000-000000000000"}


def normalize_user_id(user_id: Optional[str]) -> str:
    """Ensures user_id is a valid, deterministic UUID string across PostgreSQL and SQLite."""
    if not user_id or str(user_id).strip() in _SENTINEL_USERS:
        return settings.DEFAULT_LOCAL_USER

    user_str = str(user_id).strip()
    try:
        return str(uuid.UUID(user_str))
    except (ValueError, TypeError):
        return str(uuid.uuid5(uuid.NAMESPACE_DNS, user_str))


def is_guest_user(user_id: Optional[str]) -> bool:
    """Returns True if the user is an ephemeral guest session."""
    return bool(user_id and str(user_id).startswith("guest_"))


def is_default_or_local_user(user_id: Optional[str]) -> bool:
    """Returns True if the user is the default local developer instance user."""
    if not user_id or str(user_id).strip() in _SENTINEL_USERS:
        return True
    return normalize_user_id(user_id) == settings.DEFAULT_LOCAL_USER or user_id == settings.DEFAULT_LOCAL_USER


def build_user_filter(user_id: str) -> Filter:
    """THE SINGLE CHOKE POINT for Qdrant vector retrieval filtering.

    Guarantees that a query is ALWAYS filtered by user_id across both
    'metadata.user_id' and 'user_id' payload fields.
    """
    clean_uid = str(user_id).strip() if user_id else ""
    if not clean_uid:
        raise ValueError("Security violation: user_id is required for vector filtering.")

    norm_uid = normalize_user_id(clean_uid)
    uids = [clean_uid] if norm_uid == clean_uid else [clean_uid, norm_uid]

    conditions = [
        FieldCondition(key=field, match=MatchValue(value=uid))
        for uid in uids
        for field in ("metadata.user_id", "user_id")
    ]
    return Filter(should=conditions)


def build_user_and_file_filter(filenames: List[str], user_id: str) -> Filter:
    """Builds a combined filter enforcing BOTH user ownership AND filename match."""
    if not filenames:
        raise ValueError("At least one filename must be specified.")
    if not user_id:
        raise ValueError("user_id must be specified.")

    user_cond = build_user_filter(user_id)
    matcher = MatchValue(value=filenames[0]) if len(filenames) == 1 else MatchAny(any=filenames)

    file_cond = Filter(
        should=[
            FieldCondition(key="metadata.filename", match=matcher),
            FieldCondition(key="filename", match=matcher),
        ]
    )
    return Filter(must=[file_cond, user_cond])


def sanitize_filename(filename: str) -> str:
    """Sanitizes filename to prevent directory traversal and injection attacks."""
    if not filename or not isinstance(filename, str):
        raise ValueError("Filename must be a non-empty string.")

    safe_name = os.path.basename(filename.strip().replace("\\", "/")).replace("\x00", "")
    if not safe_name or safe_name.startswith("."):
        raise ValueError(f"Invalid filename '{filename}': hidden or empty file names are disallowed.")
    if len(safe_name) > 255:
        raise ValueError("Filename exceeds maximum length of 255 characters.")

    return safe_name


def sanitize_user_id_for_path(user_id: Optional[str]) -> str:
    """Sanitizes user_id for safe usage in filesystem directory paths."""
    if not user_id or is_default_or_local_user(user_id):
        return "default"

    clean_id = str(user_id).strip()
    return clean_id if re.match(r"^[a-zA-Z0-9_-]{1,128}$", clean_id) else normalize_user_id(clean_id)


def validate_file_extension(filename: str) -> str:
    """Validates that the file has an allowed extension and returns the normalized extension."""
    safe_name = sanitize_filename(filename)
    _, ext = os.path.splitext(safe_name)
    ext_clean = ext.lower()

    if not ext_clean or ext_clean not in settings.ALLOWED_FILE_EXTENSIONS:
        raise ValueError(
            f"File extension '{ext_clean}' is not supported. Allowed extensions: {sorted(settings.ALLOWED_FILE_EXTENSIONS)}"
        )
    return ext_clean
