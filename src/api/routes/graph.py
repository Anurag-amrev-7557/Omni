"""Knowledge Graph inspection, background construction, and hierarchical community endpoints."""
import os
from fastapi import APIRouter, Depends, Query, Response, BackgroundTasks, HTTPException

from src.core.logging import logger
from src.core.auth import require_user, set_current_user
from src.storage.file_storage import resolve_document_path
from src.graph import (
    get_user_graph,
    sync_and_prune_graph,
    clear_user_graph,
    run_community_detection_and_summaries,
    extract_and_cluster,
)
from src.storage.docs_db import get_user_documents
from src.ingestion.extractors import load_document

router = APIRouter(tags=["Knowledge Graph"])


@router.get("/api/graph")
def get_graph(response: Response = None, user_id: str = Depends(require_user)):
    """Fetches complete Knowledge Graph (nodes, links, communities, metrics) strictly scoped to user."""
    if response:
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    set_current_user(user_id)

    try:
        # 1. Fetch active filenames for this user
        vault_docs = get_user_documents(user_id=user_id)
        active_filenames = [d["filename"] for d in vault_docs if d.get("filename")]

        # 2. Prune obsolete or deleted document graph entries
        sync_and_prune_graph(user_id=user_id, active_filenames=active_filenames)

        # 3. Return fresh graph strictly scoped to current vault documents
        return get_user_graph(user_id=user_id, active_filenames=active_filenames)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch knowledge graph: {exc}")


@router.post("/api/graph/build")
def build_graph(
    background_tasks: BackgroundTasks,
    force_rebuild: bool = Query(True, description="Force complete graph rebuild"),
    user_id: str = Depends(require_user),
):
    """Schedules background knowledge graph construction across user's active vault documents."""
    set_current_user(user_id)

    def graph_worker(force: bool, uid: str):
        try:
            if force:
                clear_user_graph(user_id=uid)

            vault_docs = get_user_documents(user_id=uid)
            doc_files = []
            for vd in vault_docs:
                fn = vd["filename"]
                p = resolve_document_path(fn, user_id=uid)
                if p and os.path.exists(p):
                    doc_files.append((p, fn))

            total_extracted = 0
            for path, filename in doc_files:
                try:
                    pages = load_document(path)
                    chunks_to_process = pages[:6]
                    if chunks_to_process:
                        res = extract_and_cluster(
                            chunks=chunks_to_process,
                            filename=filename,
                            user_id=uid,
                            clear_existing=not force,
                            run_clustering=False,
                        )
                        total_extracted += res.get("entities_count", 0) + res.get("relations_count", 0)
                except Exception as doc_exc:
                    logger.warning(f"Error extracting from {filename}: {doc_exc}")

            if total_extracted > 2 or force:
                run_community_detection_and_summaries(user_id=uid)
            logger.info(f"Completed graph build across {len(doc_files)} files for user {uid}")
        except Exception as exc:
            logger.error(f"Error during graph build: {exc}")

    background_tasks.add_task(graph_worker, force_rebuild, user_id)
    return {"status": "accepted", "message": "Knowledge graph build task scheduled"}


@router.get("/api/graph/communities")
def get_graph_communities(user_id: str = Depends(require_user)):
    """Fetches hierarchical community summaries for the authenticated user."""
    set_current_user(user_id)
    try:
        graph_data = get_user_graph(user_id=user_id)
        return {
            "communities": graph_data.get("communities", []),
            "total": len(graph_data.get("communities", [])),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch communities: {exc}")


@router.post("/api/graph/update-communities")
def update_communities(user_id: str = Depends(require_user)):
    """Triggers Louvain community detection and summary clustering on existing graph data."""
    set_current_user(user_id)
    try:
        result = run_community_detection_and_summaries(user_id=user_id)
        graph_data = get_user_graph(user_id=user_id)
        return {
            "success": True,
            "message": "Community detection completed",
            "communities_updated": len(graph_data.get("communities", [])),
            "result": result,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to update communities: {exc}")
