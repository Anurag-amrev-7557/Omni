from qdrant_client import QdrantClient
from qdrant_client.models import VectorParams, Distance, Filter, FieldCondition, MatchValue
try:
    from src.config import QDRANT_URL, QDRANT_API_KEY, QDRANT_PATH, COLLECTION_NAME
except ImportError:
    from config import QDRANT_URL, QDRANT_API_KEY, QDRANT_PATH, COLLECTION_NAME


_qdrant_client_instance = None


def get_qdrant_client() -> QdrantClient:
    """Establishes and returns a singleton QdrantClient instance."""
    global _qdrant_client_instance
    if _qdrant_client_instance is not None:
        return _qdrant_client_instance

    if QDRANT_URL:
        _qdrant_client_instance = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)
    else:
        _qdrant_client_instance = QdrantClient(path=QDRANT_PATH)
    return _qdrant_client_instance

def init_db():
    """Ensures the Qdrant collection exists."""
    client = get_qdrant_client()
    try:
        collections = [c.name for c in client.get_collections().collections]
        print(f"[DEBUG] Available collections: {collections}")
        print(f"[DEBUG] Target collection name: {COLLECTION_NAME}")
        
        if COLLECTION_NAME not in collections:
            client.create_collection(
                collection_name=COLLECTION_NAME,
                vectors_config=VectorParams(size=384, distance=Distance.COSINE),
            )
            print(f"Qdrant collection '{COLLECTION_NAME}' created successfully.")
        else:
            print(f"Qdrant collection '{COLLECTION_NAME}' already exists.")
            
        # Check collection stats
        info = client.get_collection(collection_name=COLLECTION_NAME)
        print(f"[DEBUG] Collection '{COLLECTION_NAME}' has {info.points_count} points")
    except Exception as e:
        print(f"Error initializing Qdrant collection: {e}")


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


def delete_file_from_collection(filename: str):
    """Deletes all vector chunks belonging to a specific filename."""
    client = get_qdrant_client()
    try:
        client.delete(
            collection_name=COLLECTION_NAME,
            points_selector=Filter(
                must=[
                    FieldCondition(
                        key="filename",
                        match=MatchValue(value=filename)
                    )
                ]
            )
        )
        print(f"Deleted vector chunks for '{filename}' from Qdrant.")
    except Exception as e:
        print(f"Error deleting vectors for '{filename}': {e}")



def get_collection_stats() -> dict:
    """Returns total points count and list of unique ingested filenames."""
    client = get_qdrant_client()
    try:
        collections = [c.name for c in client.get_collections().collections]
        if COLLECTION_NAME not in collections:
            return {"total_chunks": 0, "files": []}
        
        info = client.get_collection(collection_name=COLLECTION_NAME)
        total_chunks = info.points_count if hasattr(info, 'points_count') else 0

        # Scroll to collect unique filenames
        scroll_res = client.scroll(
            collection_name=COLLECTION_NAME,
            limit=500,
            with_payload=True,
            with_vectors=False
        )
        points = scroll_res[0] if scroll_res else []
        files = set()
        for p in points:
            if not p.payload:
                continue
            fname = p.payload.get("filename") or p.payload.get("metadata", {}).get("filename")
            if fname:
                files.add(fname)
        return {"total_chunks": total_chunks, "files": sorted(list(files))}
    except Exception as e:
        print(f"Error getting collection stats: {e}")
        return {"total_chunks": 0, "files": []}