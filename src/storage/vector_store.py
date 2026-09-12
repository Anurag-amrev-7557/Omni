"""Qdrant Vector Database Client and Tenant-Scoped Vector Management."""
import threading
import time
from typing import Optional, List, Dict, Any, Tuple
from qdrant_client import QdrantClient
from qdrant_client.models import VectorParams, Distance

from src.config.settings import settings
from src.core.logging import logger
from src.core.security import (
    normalize_user_id,
    build_user_filter,
    build_user_and_file_filter,
)

_qdrant_client_instance: Optional[QdrantClient] = None
_qdrant_lock = threading.Lock()

_stats_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_STATS_CACHE_TTL: float = 20.0


def get_qdrant_client() -> QdrantClient:
    """Returns singleton QdrantClient instance (supports remote Qdrant Cloud and local embedded)."""
    global _qdrant_client_instance
    if _qdrant_client_instance is not None:
        return _qdrant_client_instance

    with _qdrant_lock:
        if _qdrant_client_instance is not None:
            return _qdrant_client_instance

        if settings.QDRANT_URL and settings.QDRANT_URL.strip():
            url = settings.QDRANT_URL.strip()
            logger.info(f"Connecting to remote Qdrant cluster: {url}")
            _qdrant_client_instance = QdrantClient(
                url=url,
                api_key=settings.QDRANT_API_KEY.strip() if settings.QDRANT_API_KEY else None,
                timeout=settings.QDRANT_TIMEOUT,
            )
        else:
            logger.info(f"Using embedded local Qdrant storage at: {settings.QDRANT_PATH}")
            _qdrant_client_instance = QdrantClient(path=settings.QDRANT_PATH)

    return _qdrant_client_instance


_indices_checked = False
_db_initialized = False


def ensure_payload_indices(client: Optional[QdrantClient] = None, col_name: Optional[str] = None, force: bool = False):
    """Ensures all required payload indices exist in Qdrant for user isolation and filename filtering."""
    global _indices_checked
    if _indices_checked and not force:
        return

    if client is None:
        client = get_qdrant_client()
    if col_name is None:
        col_name = settings.COLLECTION_NAME

    for field_name in ["metadata.user_id", "user_id", "metadata.filename", "filename"]:
        try:
            client.create_payload_index(
                collection_name=col_name,
                field_name=field_name,
                field_schema="keyword",
            )
            logger.info(f"Ensured payload index on '{field_name}' in '{col_name}'")
        except Exception as idx_err:
            logger.debug(f"Payload index creation note for {field_name}: {idx_err}")
    _indices_checked = True


def init_db(force: bool = False):
    """Ensures the Qdrant collection and payload indices exist for efficient tenant-isolated filtering."""
    global _db_initialized
    if _db_initialized and not force:
        return

    client = get_qdrant_client()
    col_name = settings.COLLECTION_NAME
    try:
        collections = [c.name for c in client.get_collections().collections]
        if col_name not in collections:
            client.create_collection(
                collection_name=col_name,
                vectors_config=VectorParams(
                    size=settings.EMBEDDING_DIMENSION,
                    distance=Distance.COSINE,
                ),
            )
            logger.info(f"Created Qdrant collection '{col_name}'")
        else:
            logger.debug(f"Qdrant collection '{col_name}' ready")

        # ALWAYS ensure payload indices exist, whether the collection was just created or already existed
        ensure_payload_indices(client=client, col_name=col_name, force=force)
        _db_initialized = True
    except Exception as e:
        logger.error(f"Error initializing Qdrant collection: {e}")


def clear_collection():
    """Administrative utility to drop and recreate the entire Qdrant collection across all tenants."""
    global _db_initialized, _indices_checked
    client = get_qdrant_client()
    col_name = settings.COLLECTION_NAME
    try:
        client.delete_collection(collection_name=col_name)
        client.create_collection(
            collection_name=col_name,
            vectors_config=VectorParams(
                size=settings.EMBEDDING_DIMENSION,
                distance=Distance.COSINE,
            ),
        )
        _db_initialized = False
        _indices_checked = False
        invalidate_stats_cache()
        logger.info(f"Qdrant collection '{col_name}' cleared successfully.")
    except Exception as e:
        logger.error(f"Error clearing Qdrant collection: {e}")


def delete_files_from_collection(filenames: List[str], user_id: Optional[str] = None):
    """Deletes vector chunks belonging to given filenames, strictly scoped to the requesting user.

    SECURITY: user_id is REQUIRED.  A missing or empty user_id raises ValueError rather than
    silently issuing a filename-only delete that would cross tenant boundaries.
    """
    if not filenames:
        return

    # SECURITY GATE: refuse to delete without an explicit, non-sentinel user scope.
    # This prevents a missing user_id from deleting matching filenames across ALL tenants.
    if not user_id or not str(user_id).strip():
        raise ValueError(
            "Security violation: user_id is required for scoped vector deletion. "
            "Refusing to delete vectors without an explicit user scope."
        )

    client = get_qdrant_client()
    col_name = settings.COLLECTION_NAME

    try:
        delete_selector = build_user_and_file_filter(filenames, user_id)

        with _qdrant_lock:
            client.delete(
                collection_name=col_name,
                points_selector=delete_selector,
            )
        invalidate_stats_cache(user_id=user_id)
        logger.info(f"Deleted vector chunks for {len(filenames)} files (user: {user_id})")
    except ValueError:
        raise  # re-raise security violations unchanged
    except Exception as e:
        logger.error(f"Error deleting vectors for files: {e}")


def delete_file_from_collection(filename: str, user_id: Optional[str] = None):
    """Deletes vector chunks for a specific file, scoped to user."""
    delete_files_from_collection([filename], user_id=user_id)


def delete_user_vectors(user_id: str):
    """Deletes all vector chunks belonging strictly to a specific user or guest session."""
    if not user_id:
        return
    client = get_qdrant_client()
    col_name = settings.COLLECTION_NAME
    try:
        user_selector = build_user_filter(user_id)
        with _qdrant_lock:
            client.delete(
                collection_name=col_name,
                points_selector=user_selector,
            )
        invalidate_stats_cache(user_id=user_id)
        logger.info(f"Cleaned up all vectors for user: {user_id}")
    except Exception as e:
        logger.error(f"Error deleting user vectors: {e}")


def invalidate_stats_cache(user_id: Optional[str] = None):
    """Invalidates collection stats cache for all or a specific user."""
    global _stats_cache
    if user_id:
        key = normalize_user_id(user_id)
        _stats_cache.pop(key, None)
        _stats_cache.pop(str(user_id), None)
        _stats_cache.pop("default", None)
        _stats_cache.pop(settings.DEFAULT_LOCAL_USER, None)
    else:
        _stats_cache.clear()


def get_collection_stats(user_id: Optional[str] = None) -> Dict[str, Any]:
    """Returns total points count and list of unique ingested filenames STRICTLY scoped to user."""
    cache_key = str(user_id or "default")
    now = time.time()
    if cache_key in _stats_cache:
        cached_time, cached_val = _stats_cache[cache_key]
        if now - cached_time < _STATS_CACHE_TTL:
            return cached_val

    client = get_qdrant_client()
    col_name = settings.COLLECTION_NAME
    try:
        collections = [c.name for c in client.get_collections().collections]
        if col_name not in collections:
            res = {"total_chunks": 0, "files": []}
            _stats_cache[cache_key] = (now, res)
            return res

        # Build user-scoped scroll filter to NEVER leak other users' files
        scroll_filter = build_user_filter(user_id) if user_id else None

        files = set()
        user_points_count = 0
        offset = None

        while True:
            scroll_res = client.scroll(
                collection_name=col_name,
                limit=100,
                offset=offset,
                scroll_filter=scroll_filter,
                with_payload=True,
                with_vectors=False,
            )
            points, next_offset = scroll_res if scroll_res else ([], None)
            for p in points:
                user_points_count += 1
                if not p.payload:
                    continue
                fname = p.payload.get("metadata", {}).get("filename") or p.payload.get("filename")
                if fname:
                    files.add(fname)
            if next_offset is None:
                break
            offset = next_offset

        res = {"total_chunks": user_points_count, "files": sorted(list(files))}
        _stats_cache[cache_key] = (now, res)
        return res
    except Exception as e:
        err_str = str(e)
        if "index required" in err_str.lower() or "index" in err_str.lower():
            logger.warning(f"Missing Qdrant index detected during stats query: {e}. Auto-creating indices and retrying...")
            try:
                ensure_payload_indices(client=client, col_name=col_name, force=True)
                files = set()
                user_points_count = 0
                offset = None
                while True:
                    scroll_res = client.scroll(
                        collection_name=col_name,
                        limit=100,
                        offset=offset,
                        scroll_filter=scroll_filter,
                        with_payload=True,
                        with_vectors=False,
                    )
                    points, next_offset = scroll_res if scroll_res else ([], None)
                    for p in points:
                        user_points_count += 1
                        if not p.payload:
                            continue
                        fname = p.payload.get("metadata", {}).get("filename") or p.payload.get("filename")
                        if fname:
                            files.add(fname)
                    if next_offset is None:
                        break
                    offset = next_offset

                res = {"total_chunks": user_points_count, "files": sorted(list(files))}
                _stats_cache[cache_key] = (now, res)
                return res
            except Exception as retry_e:
                logger.error(f"Failed retry of collection stats after creating indices: {retry_e}")

        logger.error(f"Error getting collection stats: {e}")
        return {"total_chunks": 0, "files": []}
