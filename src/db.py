from qdrant_client import QdrantClient
from qdrant_client.models import VectorParams, Distance, Filter, FieldCondition, MatchValue
try:
    from src.config import QDRANT_URL, QDRANT_API_KEY, QDRANT_PATH, COLLECTION_NAME
except ImportError:
    from config import QDRANT_URL, QDRANT_API_KEY, QDRANT_PATH, COLLECTION_NAME


_qdrant_client_instance = None


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
    from qdrant_client.models import CreatePayloadIndexRequest, PayloadSchemaType
    
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
            
            # Create indexes for efficient filtering
            try:
                # Index on user_id (for filtering by user)
                client.create_payload_index(
                    collection_name=COLLECTION_NAME,
                    field_name="metadata.user_id",
                    field_schema=PayloadSchemaType.KEYWORD,
                )
                print(f"[DB] ✓ Created index on metadata.user_id")
            except Exception as e:
                print(f"[DB] Warning: Could not create user_id index: {e}")
            
            try:
                # Index on filename (for filtering by file)
                client.create_payload_index(
                    collection_name=COLLECTION_NAME,
                    field_name="metadata.filename",
                    field_schema=PayloadSchemaType.KEYWORD,
                )
                print(f"[DB] ✓ Created index on metadata.filename")
            except Exception as e:
                print(f"[DB] Warning: Could not create filename index: {e}")
        else:
            print(f"[DB] ✓ Collection '{COLLECTION_NAME}' already exists")
            
            # Verify indexes exist, create if missing
            try:
                collection_info = client.get_collection(collection_name=COLLECTION_NAME)
                payload_schema = getattr(collection_info, 'payload_schema', {})
                
                # Check if indexes need to be created
                if not payload_schema or 'metadata.user_id' not in str(payload_schema):
                    try:
                        client.create_payload_index(
                            collection_name=COLLECTION_NAME,
                            field_name="metadata.user_id",
                            field_schema=PayloadSchemaType.KEYWORD,
                        )
                        print(f"[DB] ✓ Added missing index on metadata.user_id")
                    except Exception as e:
                        print(f"[DB] Warning: Could not add user_id index: {e}")
            except Exception as e:
                print(f"[DB] Warning: Could not verify indexes: {e}")
                
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
    except Exception as e:
        print(f"Error clearing Qdrant collection: {e}")


def delete_file_from_collection(filename: str, user_id: str | None = None):
    """Deletes all vector chunks belonging to a specific filename, optionally scoped to a user."""
    client = get_qdrant_client()
    try:
        file_condition = Filter(
            should=[
                FieldCondition(
                    key="metadata.filename",
                    match=MatchValue(value=filename)
                ),
                FieldCondition(
                    key="filename",
                    match=MatchValue(value=filename)
                )
            ]
        )
        if user_id:
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
        else:
            delete_selector = file_condition

        client.delete(
            collection_name=COLLECTION_NAME,
            points_selector=delete_selector
        )
        print(f"Deleted vector chunks for '{filename}' (user: {user_id or 'all'}) from Qdrant.")
    except Exception as e:
        print(f"Error deleting vectors for '{filename}': {e}")


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
        client.delete(
            collection_name=COLLECTION_NAME,
            points_selector=user_selector
        )
        print(f"[Qdrant] Cleaned up all vectors for user: {user_id}")
    except Exception as e:
        print(f"[Qdrant Error] Error cleaning up vectors for user '{user_id}': {e}")



def get_collection_stats(user_id: str | None = None) -> dict:
    """Returns total points count and list of unique ingested filenames with complete pagination, optionally scoped to a user."""
    client = get_qdrant_client()
    try:
        collections = [c.name for c in client.get_collections().collections]
        if COLLECTION_NAME not in collections:
            return {"total_chunks": 0, "files": []}
        
        info = client.get_collection(collection_name=COLLECTION_NAME)
        total_chunks = info.points_count if hasattr(info, 'points_count') else 0

        scroll_filter = None
        if user_id and user_id not in ("default_user", "00000000-0000-0000-0000-000000000000"):
            scroll_filter = Filter(
                should=[
                    FieldCondition(key="metadata.user_id", match=MatchValue(value=user_id)),
                    FieldCondition(key="user_id", match=MatchValue(value=user_id)),
                ]
            )

        files = set()
        user_points_count = 0
        offset = None
        while True:
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

        points_result = user_points_count if scroll_filter is not None else total_chunks
        return {"total_chunks": points_result, "files": sorted(list(files))}
    except Exception as e:
        print(f"Error getting collection stats: {e}")
        return {"total_chunks": 0, "files": []}