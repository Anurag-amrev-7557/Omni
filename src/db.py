from qdrant_client import QdrantClient
from qdrant_client.models import (
    VectorParams,
    Distance,
    Filter,
    FieldCondition,
    MatchValue,
    PayloadSchemaType,
)
from src.auth import get_current_user
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

        # Qdrant Cloud requires a payload index before a field can be used in a
        # filter.  LangChain stores Document.metadata under `metadata`, so the
        # actual payload path is `metadata.filename` (not simply `filename`).
        # Keep the legacy flat-field index as well for collections created by
        # older versions of the application.
        for field_name in ("metadata.filename", "metadata.user_id", "filename"):
            client.create_payload_index(
                collection_name=COLLECTION_NAME,
                field_name=field_name,
                field_schema=PayloadSchemaType.KEYWORD,
                wait=True,
            )
        print("Qdrant filename payload indexes are ready.")
            
        # Check collection stats
        info = client.get_collection(collection_name=COLLECTION_NAME)
        print(f"[DEBUG] Collection '{COLLECTION_NAME}' has {info.points_count} points")
    except Exception as e:
        print(f"Error initializing Qdrant collection: {e}")


def clear_collection():
    """Deletes only the current user's vectors; never resets other tenants."""
    client = get_qdrant_client()
    try:
        client.delete(collection_name=COLLECTION_NAME, points_selector=Filter(must=[FieldCondition(key="metadata.user_id", match=MatchValue(value=get_current_user()))]), wait=True)
    except Exception as e:
        print(f"Error clearing Qdrant collection: {e}")


def delete_file_from_collection(filename: str):
    """Deletes all vector chunks belonging to a specific filename."""
    client = get_qdrant_client()
    user_id = get_current_user()
    client.delete(
        collection_name=COLLECTION_NAME,
        points_selector=Filter(
            must=[
                FieldCondition(key="metadata.user_id", match=MatchValue(value=user_id)),
                Filter(
                    should=[
                        FieldCondition(key="metadata.filename", match=MatchValue(value=filename)),
                        FieldCondition(key="filename", match=MatchValue(value=filename)),
                    ]
                )
            ]
        ),
        wait=True,
    )
    print(f"Deleted vector chunks for '{filename}' from Qdrant.")



def get_collection_stats() -> dict:
    """Returns collection totals plus document metadata stored in Qdrant."""
    client = get_qdrant_client()
    try:
        collections = [c.name for c in client.get_collections().collections]
        if COLLECTION_NAME not in collections:
            return {"total_chunks": 0, "files": [], "file_details": {}}
        
        total_chunks = 0

        # Scroll through every point; a single 500-point page silently hid
        # documents in larger collections.
        file_details = {}
        offset = None
        while True:
            points, offset = client.scroll(
                collection_name=COLLECTION_NAME,
                limit=500,
                offset=offset,
                scroll_filter=Filter(must=[FieldCondition(key="metadata.user_id", match=MatchValue(value=get_current_user()))]),
                with_payload=True,
                with_vectors=False,
            )
            for point in points:
                payload = point.payload or {}
                metadata = payload.get("metadata") or {}
                filename = metadata.get("filename") or payload.get("filename")
                if not filename:
                    continue
                details = file_details.setdefault(filename, {"chunks": 0, "pages": set()})
                details["chunks"] += 1
                total_chunks += 1
                page = metadata.get("page") or payload.get("page")
                if isinstance(page, int) and page > 0:
                    details["pages"].add(page)
            if offset is None:
                break

        for details in file_details.values():
            details["pages"] = max(details["pages"], default=1)
        return {
            "total_chunks": total_chunks,
            "files": sorted(file_details),
            "file_details": file_details,
        }
    except Exception as e:
        print(f"Error getting collection stats: {e}")
        return {"total_chunks": 0, "files": [], "file_details": {}}
