"""Unified file storage management for local disk and Supabase Storage bucket."""
import os
import tempfile
from typing import Optional, List, Dict, Any
from supabase import create_client, Client

from src.config.settings import settings
from src.core.logging import logger
from src.core.security import sanitize_filename, sanitize_user_id_for_path, is_default_or_local_user

_supabase_client: Optional[Client] = None


def get_supabase_client() -> Optional[Client]:
    """Returns singleton Supabase client if credentials are configured, None otherwise."""
    global _supabase_client
    if _supabase_client is not None:
        return _supabase_client

    url = settings.SUPABASE_URL.strip()
    key = settings.get_effective_supabase_key()

    if not url or not key:
        return None

    try:
        _supabase_client = create_client(url, key)
        return _supabase_client
    except Exception as e:
        logger.warning(f"Failed to initialize Supabase client: {e}")
        return None


def get_user_uploads_dir(user_id: Optional[str] = None) -> str:
    """Returns the dedicated directory for uploaded documents for the specified user.
    Guarantees that the returned directory exists and is writable, automatically
    falling back to /tmp/rag_uploads if the configured path (e.g. /var/data on Render)
    does not exist or is not writable.
    """
    safe_uid = sanitize_user_id_for_path(user_id)
    tmp_path = os.path.join("/tmp", "rag_uploads", safe_uid)
    cfg_path = os.path.join(settings.UPLOADS_DIR, safe_uid) if settings.UPLOADS_DIR else None

    candidates = [tmp_path, cfg_path] if settings.ENVIRONMENT == "production" else [cfg_path, tmp_path]
    for candidate in filter(None, candidates):
        try:
            os.makedirs(candidate, exist_ok=True)
            if os.path.isdir(candidate) and os.access(candidate, os.W_OK):
                return candidate
        except Exception as e:
            logger.warning(f"Upload directory '{candidate}' is inaccessible ({e}). Trying fallback...")

    fallback = os.path.join(tempfile.gettempdir(), "rag_uploads", safe_uid)
    os.makedirs(fallback, exist_ok=True)
    return fallback


def resolve_document_path(filename: str, user_id: Optional[str] = None) -> Optional[str]:
    """Safely resolves the local or downloaded path for a document, enforcing path sanitization."""
    try:
        safe_name = sanitize_filename(filename)
    except ValueError:
        return None

    safe_uid = sanitize_user_id_for_path(user_id)
    user_dir = get_user_uploads_dir(user_id)

    candidate_paths = [
        os.path.join(user_dir, safe_name),
        os.path.join("/tmp", "rag_uploads", safe_uid, safe_name),
    ]
    if settings.UPLOADS_DIR:
        candidate_paths.append(os.path.join(settings.UPLOADS_DIR, safe_uid, safe_name))

    for cp in candidate_paths:
        if os.path.isfile(cp):
            return cp

    local_path = os.path.join(user_dir, safe_name)

    client = get_supabase_client()
    if client:
        try:
            remote_path = f"users/{safe_uid}/{safe_name}"
            download_file(remote_path, local_path)
            if os.path.isfile(local_path):
                return local_path
        except Exception:
            pass

    if is_default_or_local_user(user_id):
        fallback_dirs = [
            os.path.join(settings.UPLOADS_DIR, "default"),
            os.path.join(settings.UPLOADS_DIR, settings.DEFAULT_LOCAL_USER),
            settings.UPLOADS_DIR,
            os.path.join(settings.APP_ROOT_DIR, "data"),
        ]
        for fdir in fallback_dirs:
            candidate = os.path.join(fdir, safe_name)
            if os.path.isfile(candidate):
                return candidate

        if client:
            for fallback_uid in ["default", settings.DEFAULT_LOCAL_USER]:
                try:
                    fb_path = os.path.join(settings.UPLOADS_DIR, fallback_uid, safe_name)
                    download_file(f"users/{fallback_uid}/{safe_name}", fb_path)
                    if os.path.isfile(fb_path):
                        return fb_path
                except Exception:
                    pass

    return None


def upload_bytes(file_bytes: bytes, remote_path: str, bucket_name: str = "documents") -> str:
    """Uploads raw bytes to Supabase Storage."""
    client = get_supabase_client()
    if not client:
        return remote_path

    client.storage.from_(bucket_name).upload(
        path=remote_path,
        file=file_bytes,
        file_options={"upsert": "true"},
    )
    logger.info(f"Uploaded {len(file_bytes)} bytes to {bucket_name}/{remote_path}")
    return remote_path


def upload_file(file_path: str, bucket_name: str = "documents", remote_path: Optional[str] = None) -> str:
    """Uploads a local file to Supabase Storage."""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    target_remote = remote_path or os.path.basename(file_path)
    with open(file_path, "rb") as f:
        upload_bytes(f.read(), target_remote, bucket_name=bucket_name)
    logger.info(f"Uploaded {file_path} to {bucket_name}/{target_remote}")
    return target_remote


def download_bytes(remote_path: str, bucket_name: str = "documents") -> bytes:
    """Downloads a file from Supabase Storage as bytes."""
    client = get_supabase_client()
    if not client:
        raise ValueError("Supabase is not configured.")
    return client.storage.from_(bucket_name).download(remote_path)


def download_file(remote_path: str, local_path: str, bucket_name: str = "documents") -> str:
    """Downloads a file from Supabase Storage to local filesystem."""
    data = download_bytes(remote_path, bucket_name=bucket_name)
    os.makedirs(os.path.dirname(os.path.abspath(local_path)), exist_ok=True)
    with open(local_path, "wb") as f:
        f.write(data)
    logger.info(f"Downloaded {remote_path} to {local_path}")
    return local_path


def delete_file(remote_path: str, bucket_name: str = "documents") -> bool:
    """Deletes a file from Supabase Storage."""
    client = get_supabase_client()
    if not client:
        return False
    try:
        client.storage.from_(bucket_name).remove([remote_path])
        logger.info(f"Deleted {remote_path} from Supabase")
        return True
    except Exception as e:
        logger.debug(f"Error deleting file from Supabase: {e}")
        return False


def list_files(prefix: str = "", bucket_name: str = "documents") -> List[Dict[str, Any]]:
    """Lists files in a Supabase Storage bucket under the specified prefix."""
    client = get_supabase_client()
    if not client:
        return []
    try:
        return client.storage.from_(bucket_name).list(prefix)
    except Exception as e:
        logger.debug(f"Error listing files in Supabase: {e}")
        return []


def get_user_files(user_id: str, bucket_name: str = "documents") -> List[Dict[str, Any]]:
    """Lists files belonging to a specific user in Supabase Storage."""
    safe_uid = sanitize_user_id_for_path(user_id)
    return list_files(prefix=f"users/{safe_uid}/", bucket_name=bucket_name)


def delete_physical_document(filename: str, user_id: Optional[str] = None):
    """Removes a document from the local filesystem across user folders."""
    try:
        safe_name = sanitize_filename(filename)
    except ValueError:
        return

    safe_uid = sanitize_user_id_for_path(user_id)
    resolved = resolve_document_path(filename, user_id=user_id)
    if resolved and os.path.isfile(resolved):
        try:
            os.remove(resolved)
            logger.info(f"Removed physical file: {resolved}")
        except Exception as e:
            logger.debug(f"Error removing physical file {resolved}: {e}")

    target_dirs = [
        os.path.join(settings.UPLOADS_DIR, safe_uid) if settings.UPLOADS_DIR else None,
        os.path.join(settings.UPLOADS_DIR, "default") if settings.UPLOADS_DIR else None,
        os.path.join(settings.UPLOADS_DIR, settings.DEFAULT_LOCAL_USER) if settings.UPLOADS_DIR else None,
        settings.UPLOADS_DIR,
        os.path.join(settings.APP_ROOT_DIR, "data"),
    ]
    if resolved:
        target_dirs.append(os.path.dirname(resolved))

    for d in {d for d in target_dirs if d and os.path.isdir(d)}:
        p = os.path.join(d, safe_name)
        if os.path.isfile(p):
            try:
                os.remove(p)
                logger.info(f"Removed physical file: {p}")
            except Exception as e:
                logger.debug(f"Error removing physical file {p}: {e}")
