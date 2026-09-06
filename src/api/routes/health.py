"""System health checks, collection statistics, and administrative diagnostics."""
import time
from fastapi import APIRouter, Response, Depends, HTTPException

from src.config.settings import settings
from src.core.auth import require_user, set_current_user
from src.storage.vector_store import get_qdrant_client, get_collection_stats, clear_collection, init_db
from src.storage.chat_db import get_all_sessions
from src.graph.db import get_db_connection, init_graph_db

router = APIRouter(tags=["Health & Diagnostics"])


@router.get("/")
def root():
    """Returns basic service status and version information."""
    return {"status": "online", "service": "Omni RAG", "version": "2.0.0"}


@router.get("/api/health")
def health_check():
    """Comprehensive multi-component health and subsystem diagnostic probe."""
    pipeline = {}
    overall_ok = True

    # 1. Vector Database (Qdrant)
    try:
        client = get_qdrant_client()
        collections = client.get_collections().collections
        qdrant_ok = any(c.name == settings.COLLECTION_NAME for c in collections)
        count_info = client.count(settings.COLLECTION_NAME).count if qdrant_ok else 0
        pipeline["qdrant"] = {
            "status": "online" if qdrant_ok else "uninitialized",
            "collection": settings.COLLECTION_NAME,
            "vector_count": count_info,
            "dimension": settings.EMBEDDING_DIMENSION,
        }
    except Exception as e:
        pipeline["qdrant"] = {"status": "error", "error": str(e)}
        overall_ok = False

    # 2. Knowledge Graph Storage
    try:
        init_graph_db()
        conn = get_db_connection()
        c = conn.cursor()
        c.execute("SELECT COUNT(*) FROM graph_entities")
        entity_count = c.fetchone()[0]
        c.execute("SELECT COUNT(*) FROM graph_relations")
        rel_count = c.fetchone()[0]
        conn.close()
        pipeline["graph_db"] = {
            "status": "online",
            "entities": entity_count,
            "relations": rel_count,
        }
    except Exception as e:
        pipeline["graph_db"] = {"status": "error", "error": str(e)}
        overall_ok = False

    # 3. LLM API (Groq)
    has_groq = len(settings.GROQ_API_KEY) > 10
    pipeline["llm"] = {
        "provider": "Groq Cloud",
        "status": "online" if has_groq else "missing_key",
        "default_model": settings.PRIMARY_LLM_MODEL,
    }
    if not has_groq:
        overall_ok = False

    # 4. Dense Embeddings
    pipeline["embeddings"] = {
        "status": "online",
        "model": settings.EMBEDDING_MODEL,
        "dimension": settings.EMBEDDING_DIMENSION,
        "mode": "FastEmbed ONNX",
    }

    return {
        "status": "healthy" if overall_ok else "degraded",
        "version": "2.0.0",
        "pipeline": pipeline,
        "timestamp": time.time(),
    }


@router.get("/api/stats")
def get_stats(response: Response, user_id: str = Depends(require_user)):
    """Returns total chunk counts and ingested file count strictly scoped to the requesting user."""
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    set_current_user(user_id)
    stats = get_collection_stats(user_id=user_id)
    sessions = get_all_sessions(user_id=user_id)
    return {
        "status": "Active",
        "total_chunks": stats["total_chunks"],
        "files_count": len(stats["files"]),
        "files": stats["files"],
        "sessions_count": len(sessions),
    }


@router.post("/api/admin/rebuild-qdrant")
def rebuild_qdrant_indexes():
    """Administrative utility to drop collection and recreate payload indexes."""
    try:
        clear_collection()
        init_db()
        return {
            "success": True,
            "message": f"Qdrant collection '{settings.COLLECTION_NAME}' recreated with proper indexes",
            "status": "online",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error rebuilding Qdrant: {str(e)}")
