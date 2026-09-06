"""Knowledge Graph extraction, entity resolution, and community clustering pipeline."""
from typing import List, Optional, Dict, Any
from langchain_core.documents import Document

from src.core.logging import logger
from src.graph.db import (
    delete_document_graph,
    run_entity_resolution_and_deduplication,
)
from src.graph.extractor import extract_entities_and_relations
from src.graph.clustering import run_community_detection_and_summaries


def extract_and_cluster(
    chunks: List[Document],
    filename: str,
    user_id: str,
    clear_existing: bool = True,
    run_clustering: Optional[bool] = None,
) -> Dict[str, Any]:
    """Extracts entities & relations from chunks, resolves entities, and optionally detects communities.

    Args:
        chunks: Pre-loaded list of Document objects to process.
        filename: Name of the source document.
        user_id: Authenticated user ID owning the graph.
        clear_existing: If True, deletes existing graph nodes/edges for this filename before extracting.
        run_clustering: If None (default), runs community detection if entities_count > 2 or relations_count > 2.
                       If True/False, acts as an explicit override forcing community detection on or off.

    Returns:
        Dict containing entities_count, relations_count, and whether clustering was run.
    """
    if clear_existing:
        delete_document_graph(filename, user_id=user_id)

    entities_count = 0
    relations_count = 0

    for chunk in chunks:
        page = chunk.metadata.get("page", 1) if hasattr(chunk, "metadata") and chunk.metadata else 1
        res = extract_entities_and_relations(
            text=chunk.page_content,
            filename=filename,
            page=page,
            user_id=user_id,
        )
        entities_count += len(res.get("entities", []))
        relations_count += len(res.get("relations", []))

    run_entity_resolution_and_deduplication(user_id=user_id)

    should_cluster = (
        run_clustering
        if run_clustering is not None
        else (entities_count > 2 or relations_count > 2)
    )

    if should_cluster:
        run_community_detection_and_summaries(user_id=user_id)

    logger.info(
        f"Knowledge Graph updated for {filename} "
        f"({entities_count} entities, {relations_count} relations, clustered={should_cluster})"
    )

    return {
        "entities_count": entities_count,
        "relations_count": relations_count,
        "clustered": should_cluster,
    }
