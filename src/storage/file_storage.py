"""Unified file storage management for local disk and Supabase Storage bucket."""
import os
import shutil
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

    # Candidate directories in order of preference
    candidates = []
    if settings.ENVIRONMENT == "production":
        candidates.append(os.path.join("/tmp", "rag_uploads", safe_uid))
        if settings.UPLOADS_DIR:
            candidates.append(os.path.join(settings.UPLOADS_DIR, safe_uid))
    else:
        if settings.UPLOADS_DIR:
            candidates.append(os.path.join(settings.UPLOADS_DIR, safe_uid))
        candidates.append(os.path.join("/tmp", "rag_uploads", safe_uid))

    for candidate in candidates:
        try:
            os.makedirs(candidate, exist_ok=True)
            if os.path.isdir(candidate) and os.access(candidate, os.W_OK):
                return candidate
        except Exception as e:
            logger.warning(f"Upload directory '{candidate}' is inaccessible ({e}). Trying fallback...")

    # Final fallback: system temporary directory
    import tempfile
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

    # 1. Local disk match across user directory candidates
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

    # 2. Check Supabase Storage under user prefix
    client = get_supabase_client()
    if client:
        try:
            remote_path = f"users/{safe_uid}/{safe_name}"
            download_file(remote_path, local_path)
            if os.path.isfile(local_path):
                return local_path
        except Exception:
            pass

    # 3. If local or default user, check shared local folders
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

        # Check default folder in Supabase
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


def upload_file(file_path: str, bucket_name: str = "documents", remote_path: Optional[str] = None) -> str:
    """Uploads a local file to Supabase Storage."""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    target_remote = remote_path or os.path.basename(file_path)
    client = get_supabase_client()
    if not client:
        return target_remote

    with open(file_path, "rb") as f:
        file_bytes = f.read()

    client.storage.from_(bucket_name).upload(
        path=target_remote,
        file=file_bytes,
        file_options={"upsert": "true"},
    )
    logger.info(f"Uploaded {file_path} to {bucket_name}/{target_remote}")
    return target_remote


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


def download_file(remote_path: str, local_path: str, bucket_name: str = "documents") -> str:
    """Downloads a file from Supabase Storage to local filesystem."""
    client = get_supabase_client()
    if not client:
        raise ValueError("Supabase is not configured.")

    response = client.storage.from_(bucket_name).download(remote_path)
    os.makedirs(os.path.dirname(os.path.abspath(local_path)), exist_ok=True)
    with open(local_path, "wb") as f:
        f.write(response)
    logger.info(f"Downloaded {remote_path} to {local_path}")
    return local_path


def download_bytes(remote_path: str, bucket_name: str = "documents") -> bytes:
    """Downloads a file from Supabase Storage as bytes."""
    client = get_supabase_client()
    if not client:
        raise ValueError("Supabase is not configured.")
    return client.storage.from_(bucket_name).download(remote_path)


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
    target_dirs = [
        os.path.join(settings.UPLOADS_DIR, safe_uid),
        os.path.join(settings.UPLOADS_DIR, "default"),
        os.path.join(settings.UPLOADS_DIR, settings.DEFAULT_LOCAL_USER),
        settings.UPLOADS_DIR,
        os.path.join(settings.APP_ROOT_DIR, "data"),
    ]
    resolved = resolve_document_path(filename, user_id=user_id)
    if resolved:
        target_dirs.append(os.path.dirname(resolved))

    for d in set(target_dirs):
        p = os.path.join(d, safe_name)
        if os.path.isfile(p):
            try:
                os.remove(p)
                logger.info(f"Removed physical file: {p}")
            except Exception as e:
                logger.debug(f"Error removing physical file {p}: {e}")
