"""Knowledge Graph inspection, background construction, and hierarchical community endpoints."""
import os
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response

from src.core.auth import require_user, set_current_user
from src.core.logging import logger
from src.graph import (
    clear_user_graph,
    extract_and_cluster,
    get_user_graph,
    run_community_detection_and_summaries,
)
from src.ingestion.extractors import load_document
from src.storage.docs_db import get_user_documents
from src.storage.file_storage import resolve_document_path

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
        active_filenames = [d["filename"] for d in get_user_documents(user_id=user_id) if d.get("filename")]
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

            doc_files = [
                (p, vd["filename"]) for vd in get_user_documents(user_id=uid)
                if (p := resolve_document_path(vd.get("filename", ""), user_id=uid)) and os.path.exists(p)
            ]

            total_extracted = 0
            for path, filename in doc_files:
                try:
                    pages = load_document(path)
                    if chunks_to_process := pages[:6]:
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
        communities = get_user_graph(user_id=user_id).get("communities", [])
        return {"communities": communities, "total": len(communities)}
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
