import threading
from qdrant_client import QdrantClient
from qdrant_client.models import VectorParams, Distance, Filter, FieldCondition, MatchValue, MatchAny
try:
    from src.config import QDRANT_URL, QDRANT_API_KEY, QDRANT_PATH, COLLECTION_NAME
except ImportError:
    from config import QDRANT_URL, QDRANT_API_KEY, QDRANT_PATH, COLLECTION_NAME

_qdrant_client_instance = None
_qdrant_lock = threading.Lock()


def get_qdrant_client() -> QdrantClient:
    """Establishes and returns a singleton QdrantClient instance (supports remote Qdrant Cloud and local embedded)."""
    global _qdrant_client_instance
    if _qdrant_client_instance is not None:
        return _qdrant_client_instance

    if QDRANT_URL and QDRANT_URL.strip():
        url = QDRANT_URL.strip()
        print(f"[DB] Connecting to remote Qdrant cluster: {url}")
        _qdrant_client_instance = QdrantClient(
            url=url,
            api_key=QDRANT_API_KEY.strip() if QDRANT_API_KEY else None,
            timeout=60.0,
        )
    else:
        print(f"[DB] Using embedded local Qdrant storage at: {QDRANT_PATH}")
        _qdrant_client_instance = QdrantClient(path=QDRANT_PATH)
    return _qdrant_client_instance

def init_db():
    """
    Ensures the Qdrant collection exists with proper indexes.
    
    The collection needs indexes on user_id and filename for efficient filtering.
    """
    client = get_qdrant_client()
    try:
        collections = [c.name for c in client.get_collections().collections]
        
        if COLLECTION_NAME not in collections:
            # Create collection with proper configuration
            client.create_collection(
                collection_name=COLLECTION_NAME,
                vectors_config=VectorParams(size=384, distance=Distance.COSINE),
            )
            print(f"[DB] ✓ Created Qdrant collection '{COLLECTION_NAME}'")
            
            # Try to create indexes (may not be supported on all versions)
            try:
                # Index on user_id (for filtering by user)
                client.create_payload_index(
                    collection_name=COLLECTION_NAME,
                    field_name="metadata.user_id",
                    field_schema="keyword",
                )
                print(f"[DB] ✓ Created index on metadata.user_id")
            except Exception as e:
                print(f"[DB] Note: Could not create user_id index: {e}")
            
            try:
                # Index on filename (for filtering by file)
                client.create_payload_index(
                    collection_name=COLLECTION_NAME,
                    field_name="metadata.filename",
                    field_schema="keyword",
                )
                print(f"[DB] ✓ Created index on metadata.filename")
            except Exception as e:
                print(f"[DB] Note: Could not create filename index: {e}")
        else:
            print(f"[DB] ✓ Collection '{COLLECTION_NAME}' already exists")
                
    except Exception as e:
        print(f"[DB] Error initializing Qdrant collection: {e}")


def clear_collection():
    """Deletes and recreates the Qdrant collection."""
    client = get_qdrant_client()
    try:
        client.delete_collection(collection_name=COLLECTION_NAME)
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(size=384, distance=Distance.COSINE),
        )
        print(f"Qdrant collection '{COLLECTION_NAME}' cleared successfully.")
        invalidate_stats_cache()
    except Exception as e:
        print(f"Error clearing Qdrant collection: {e}")


def delete_files_from_collection(filenames: list[str], user_id: str | None = None):
    """Deletes all vector chunks belonging to given filenames, optionally scoped to a user."""
    if not filenames:
        return
    client = get_qdrant_client()
    try:
        # Build file filter using MatchAny or MatchValue
        if len(filenames) == 1:
            file_condition = Filter(
                should=[
                    FieldCondition(
                        key="metadata.filename",
                        match=MatchValue(value=filenames[0])
                    ),
                    FieldCondition(
                        key="filename",
                        match=MatchValue(value=filenames[0])
                    )
                ]
            )
        else:
            file_condition = Filter(
                should=[
                    FieldCondition(
                        key="metadata.filename",
                        match=MatchAny(any=filenames)
                    ),
                    FieldCondition(
                        key="filename",
                        match=MatchAny(any=filenames)
                    )
                ]
            )
        
        delete_selector = file_condition
        # For guest, local, or default users, remove vectors across all local/guest aliases unconditionally
        is_guest_or_local = (
            not user_id or 
            user_id in ("default_user", "10d2f529-3fae-4a29-9a5e-312876700ff9", "default") or 
            str(user_id).startswith("guest_")
        )
        if user_id and not is_guest_or_local:
            try:
                user_condition = Filter(
                    should=[
                        FieldCondition(
                            key="metadata.user_id",
                            match=MatchValue(value=user_id)
                        ),
                        FieldCondition(
                            key="user_id",
                            match=MatchValue(value=user_id)
                        )
                    ]
                )
                delete_selector = Filter(must=[file_condition, user_condition])
            except Exception as e:
                print(f"[DB] Note: Could not filter by user_id: {e}, using filename only")
                delete_selector = file_condition

        with _qdrant_lock:
            client.delete(
                collection_name=COLLECTION_NAME,
                points_selector=delete_selector
            )
        invalidate_stats_cache()
        print(f"[DB] Deleted vector chunks for {len(filenames)} files: {filenames[:5]} (user: {user_id or 'all'})")
    except Exception as e:
        print(f"[DB] Error deleting vectors for files: {e}")


def delete_file_from_collection(filename: str, user_id: str | None = None):
    """Deletes all vector chunks belonging to a specific filename, optionally scoped to a user."""
    delete_files_from_collection([filename], user_id=user_id)


def delete_user_vectors(user_id: str):
    """Deletes all vector chunks belonging to a user or ephemeral guest session from Qdrant."""
    if not user_id:
        return
    client = get_qdrant_client()
    try:
        user_selector = Filter(
            should=[
                FieldCondition(
                    key="metadata.user_id",
                    match=MatchValue(value=user_id)
                ),
                FieldCondition(
                    key="user_id",
                    match=MatchValue(value=user_id)
                )
            ]
        )
        with _qdrant_lock:
            client.delete(
                collection_name=COLLECTION_NAME,
                points_selector=user_selector
            )
        invalidate_stats_cache()
        print(f"[DB] ✓ Cleaned up all vectors for user: {user_id}")
    except Exception as e:
        print(f"[DB] Note: Could not delete by user_id (likely missing index): {e}")



import time

_stats_cache: dict[str, tuple[float, dict]] = {}
_STATS_CACHE_TTL: float = 20.0

def invalidate_stats_cache():
    """Invalidates the in-memory collection stats cache."""
    global _stats_cache
    _stats_cache.clear()


def get_collection_stats(user_id: str | None = None) -> dict:
    """Returns total points count and list of unique ingested filenames with complete pagination, optionally scoped to a user."""
    cache_key = str(user_id or "default")
    now = time.time()
    if cache_key in _stats_cache:
        cached_time, cached_val = _stats_cache[cache_key]
        if now - cached_time < _STATS_CACHE_TTL:
            return cached_val

    client = get_qdrant_client()
    try:
        collections = [c.name for c in client.get_collections().collections]
        if COLLECTION_NAME not in collections:
            res = {"total_chunks": 0, "files": []}
            _stats_cache[cache_key] = (now, res)
            return res
        
        info = client.get_collection(collection_name=COLLECTION_NAME)
        total_chunks = info.points_count if hasattr(info, 'points_count') else 0

        # Don't use user_id filter if index doesn't exist (graceful fallback)
        scroll_filter = None

        files = set()
        user_points_count = 0
        offset = None
        while True:
            try:
                scroll_res = client.scroll(
                    collection_name=COLLECTION_NAME,
                    limit=100,
                    offset=offset,
                    scroll_filter=scroll_filter,
                    with_payload=True,
                    with_vectors=False
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
            except Exception as scroll_err:
                # If scroll fails due to index, return what we have
                print(f"[DB] Scroll error (likely index issue): {scroll_err}")
                break

        res = {"total_chunks": total_chunks, "files": sorted(list(files))}
        _stats_cache[cache_key] = (now, res)
        return res
    except Exception as e:
        print(f"[DB] Error getting collection stats: {e}")
        return {"total_chunks": 0, "files": []}