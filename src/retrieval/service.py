"""Tenant-Isolated Hybrid Retrieval Service (Dense + BM25 RRF + Cross-Encoder)."""
import threading
from typing import Any, Dict, List, Optional
from langchain_qdrant import QdrantVectorStore

from src.config.settings import settings
from src.core.auth import get_current_user
from src.core.logging import logger
from src.core.security import build_user_filter, is_default_or_local_user, normalize_user_id
from src.retrieval.embeddings import get_embeddings, get_reranker
from src.retrieval.hybrid import compute_reciprocal_rank_fusion
from src.storage.vector_store import ensure_payload_indices, get_collection_stats, get_qdrant_client, init_db

def get_vector_store() -> QdrantVectorStore:
    """Returns QdrantVectorStore instance using singleton client and cached embeddings."""
    init_db()
    return QdrantVectorStore(
        client=get_qdrant_client(),
        collection_name=settings.COLLECTION_NAME,
        embedding=get_embeddings(),
    )


def hybrid_search(
    query: str,
    k: int = 5,
    user_id: Optional[str] = None,
    limit: Optional[int] = None,
    active_filenames: Optional[List[str]] = None,
    **kwargs,
) -> List[Dict[str, Any]]:
    """Executes dense vector search and BM25 hybrid reciprocal rank fusion with Cross-Encoder reranking.

    CRITICAL TENANT ISOLATION:
    Always scopes vector retrieval strictly to the authenticated user.
    Never falls back to global/unscoped vector search.
    A missing, empty, or sentinel user_id returns [] immediately — no search is performed.
    """
    if active_filenames is not None and not active_filenames:
        return []

    target_k = limit if limit is not None else k
    candidate_k = max(target_k * 3, 20)

    effective_uid = user_id if user_id else get_current_user()
    norm_uid = normalize_user_id(effective_uid)

    if not user_id or is_default_or_local_user(user_id) or is_default_or_local_user(norm_uid):
        logger.debug(
            "hybrid_search: no authenticated user_id supplied (got %r); "
            "returning empty results to prevent cross-user data leak.",
            user_id,
        )
        return []

    logger.info(f"Executing hybrid search for query='{query[:50]}' user_id={norm_uid}")

    vector_store = get_vector_store()
    user_filter = build_user_filter(norm_uid)

    docs_and_scores = []
    try:
        docs_and_scores = vector_store.similarity_search_with_score(
            query,
            k=candidate_k,
            filter=user_filter,
        )
    except Exception as e:
        if "index" in str(e).lower():
            logger.warning(f"Missing Qdrant index during vector search: {e}. Auto-creating indices and retrying...")
            try:
                ensure_payload_indices(client=get_qdrant_client(), col_name=settings.COLLECTION_NAME, force=True)
                docs_and_scores = vector_store.similarity_search_with_score(
                    query,
                    k=candidate_k,
                    filter=user_filter,
                )
            except Exception as retry_err:
                logger.error(f"Vector search retry failed: {retry_err}")
        else:
            logger.error(f"Vector search exception: {e}")

    if not docs_and_scores:
        return []

    initial_candidates = [
        {
            "content": doc.metadata.get("parent_content") or doc.page_content,
            "child_snippet": doc.page_content,
            "filename": doc.metadata.get("filename", "Unknown"),
            "page": doc.metadata.get("page", 1),
            "parent_id": doc.metadata.get("parent_id"),
            "vector_score": round(float(score), 4),
        }
        for doc, score in docs_and_scores
    ]

    fused_candidates = compute_reciprocal_rank_fusion(
        dense_results=initial_candidates,
        candidate_docs=initial_candidates,
        query=query,
    )
    for doc in fused_candidates:
        doc["rerank_score"] = doc.get("rrf_score", 0.0)

    if settings.ENABLE_CROSS_ENCODER and fused_candidates:
        try:
            reranker = get_reranker()
            if reranker is not None:
                top_pool = fused_candidates[:15]
                pairs = [[query, doc.get("child_snippet") or doc["content"][:400]] for doc in top_pool]
                for doc, score in zip(top_pool, reranker.predict(pairs)):
                    doc["rerank_score"] = round(float(score), 4)
                top_pool.sort(key=lambda x: x["rerank_score"], reverse=True)
                fused_candidates = top_pool + fused_candidates[15:]
        except Exception as e:
            logger.debug(f"Cross-Encoder reranking note: {e}")

    try:
        active_files = active_filenames if active_filenames is not None else get_collection_stats(user_id=norm_uid).get("files", [])
        if active_files:
            from src.graph.traversal import traverse_subgraph
            graph_res = traverse_subgraph(query, user_id=norm_uid, active_filenames=active_files)
            if graph_res.get("contexts"):
                fused_candidates = graph_res["contexts"][:2] + fused_candidates
    except Exception as g_exc:
        logger.debug(f"Graph traversal note: {g_exc}")

    unique_candidates = []
    seen_parents = set()
    for doc in fused_candidates:
        parent_key = doc.get("parent_id") or doc.get("content")
        if parent_key not in seen_parents:
            seen_parents.add(parent_key)
            unique_candidates.append(doc)

    return unique_candidates[:target_k]
