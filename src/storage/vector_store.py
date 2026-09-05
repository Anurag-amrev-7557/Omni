"""Qdrant Vector Database Client and Tenant-Scoped Vector Management."""
import threading
import time
from typing import Any, Dict, List, Optional, Tuple
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams

from src.config.settings import settings
from src.core.logging import logger
from src.core.security import (
    build_user_and_file_filter,
    build_user_filter,
    normalize_user_id,
)

_qdrant_client_instance: Optional[QdrantClient] = None
_qdrant_lock = threading.Lock()

_stats_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_STATS_CACHE_TTL: float = 20.0
_indices_checked = False
_db_initialized = False


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
            try:
                _qdrant_client_instance = QdrantClient(path=settings.QDRANT_PATH)
            except RuntimeError as re:
                if "already accessed" in str(re).lower():
                    logger.warning(
                        f"Qdrant storage folder '{settings.QDRANT_PATH}' is locked by another running process. "
                        "Falling back to in-memory Qdrant client for concurrent access."
                    )
                    _qdrant_client_instance = QdrantClient(location=":memory:")
                else:
                    raise

    return _qdrant_client_instance


def ensure_payload_indices(client: Optional[QdrantClient] = None, col_name: Optional[str] = None, force: bool = False):
    """Ensures all required payload indices exist in Qdrant for user isolation and filename filtering."""
    global _indices_checked
    if _indices_checked and not force:
        return

    client = client or get_qdrant_client()
    col_name = col_name or settings.COLLECTION_NAME

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
    """Deletes vector chunks belonging to given filenames, strictly scoped to the requesting user."""
    if not filenames:
        return

    # SECURITY GATE: refuse to delete without an explicit, non-sentinel user scope.
    if not user_id or not str(user_id).strip():
        raise ValueError(
            "Security violation: user_id is required for scoped vector deletion. "
            "Refusing to delete vectors without an explicit user scope."
        )

    try:
        delete_selector = build_user_and_file_filter(filenames, user_id)
        with _qdrant_lock:
            get_qdrant_client().delete(
                collection_name=settings.COLLECTION_NAME,
                points_selector=delete_selector,
            )
        invalidate_stats_cache(user_id=user_id)
        logger.info(f"Deleted vector chunks for {len(filenames)} files (user: {user_id})")
    except ValueError:
        raise
    except Exception as e:
        logger.error(f"Error deleting vectors for files: {e}")


def delete_file_from_collection(filename: str, user_id: Optional[str] = None):
    """Deletes vector chunks for a specific file, scoped to user."""
    delete_files_from_collection([filename], user_id=user_id)


def delete_user_vectors(user_id: str):
    """Deletes all vector chunks belonging strictly to a specific user or guest session."""
    if not user_id:
        return
    try:
        user_selector = build_user_filter(user_id)
        with _qdrant_lock:
            get_qdrant_client().delete(
                collection_name=settings.COLLECTION_NAME,
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
        for key in (normalize_user_id(user_id), str(user_id), "default", settings.DEFAULT_LOCAL_USER):
            _stats_cache.pop(key, None)
    else:
        _stats_cache.clear()


def _scroll_user_files(client: QdrantClient, col_name: str, scroll_filter: Any) -> Dict[str, Any]:
    """Scrolls collection points matching filter and extracts unique filenames and total chunks."""
    files = set()
    user_points_count = 0
    try:
        if scroll_filter:
            count_res = client.count(collection_name=col_name, count_filter=scroll_filter, exact=True)
        else:
            count_res = client.count(collection_name=col_name, exact=True)
        raw_count = getattr(count_res, "count", None)
        user_points_count = raw_count if isinstance(raw_count, int) else 0
    except Exception:
        user_points_count = 0

    offset = None
    counted_chunks = 0
    while True:
        scroll_res = client.scroll(
            collection_name=col_name,
            limit=500,
            offset=offset,
            scroll_filter=scroll_filter,
            with_payload=["metadata.filename", "filename"],
            with_vectors=False,
        )
        points, next_offset = scroll_res if scroll_res else ([], None)
        for p in points:
            counted_chunks += 1
            if p.payload:
                fname = p.payload.get("metadata", {}).get("filename") or p.payload.get("filename")
                if fname:
                    files.add(fname)
        if next_offset is None:
            break
        offset = next_offset

    total_chunks = user_points_count if user_points_count > 0 else counted_chunks
    return {"total_chunks": total_chunks, "files": sorted(list(files))}


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

        scroll_filter = build_user_filter(user_id) if user_id else None
        try:
            res = _scroll_user_files(client, col_name, scroll_filter)
        except Exception as e:
            if "index" in str(e).lower():
                logger.warning(f"Missing Qdrant index detected during stats query: {e}. Auto-creating indices and retrying...")
                ensure_payload_indices(client=client, col_name=col_name, force=True)
                res = _scroll_user_files(client, col_name, scroll_filter)
            else:
                raise

        _stats_cache[cache_key] = (now, res)
        return res
    except Exception as e:
        logger.error(f"Error getting collection stats: {e}")
        return {"total_chunks": 0, "files": []}
