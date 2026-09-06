"""Tenant-Isolated Hybrid Retrieval Service (Dense + BM25 RRF + Cross-Encoder)."""
import os
from typing import Optional, List, Dict, Any
from langchain_qdrant import QdrantVectorStore

from src.config.settings import settings
from src.core.logging import logger
from src.core.security import build_user_filter, normalize_user_id, is_default_or_local_user
from src.core.auth import get_current_user
from src.storage.vector_store import get_qdrant_client, init_db, get_collection_stats
from src.graph.traversal import traverse_subgraph
from src.retrieval.embeddings import get_embeddings
from src.retrieval.reranker import get_reranker
from src.retrieval.hybrid import compute_reciprocal_rank_fusion


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
    if active_filenames is not None and len(active_filenames) == 0:
        return []

    target_k = limit if limit is not None else k
    candidate_k = max(target_k * 3, 20)

    # Resolve caller-supplied identity first; only fall back to context if the
    # caller explicitly passed nothing (None/empty string).
    effective_uid = user_id if user_id else get_current_user()
    norm_uid = normalize_user_id(effective_uid)

    # SECURITY GATE: block any call where the resolved identity is the
    # default/local sentinel — whether the caller passed nothing (None/"")
    # OR explicitly passed the sentinel string ("default_user", the all-zero
    # UUID, etc.).  Both cases are semantically "no real user" and must never
    # silently search the DEFAULT_LOCAL_USER's vault.
    #
    # We evaluate is_default_or_local_user on the RAW caller arg first (catches
    # explicit sentinel strings like "default_user"), then on norm_uid as a
    # belt-and-suspenders check after normalisation.
    if not user_id or is_default_or_local_user(user_id) or is_default_or_local_user(norm_uid):
        logger.debug(
            "hybrid_search: no authenticated user_id supplied (got %r); "
            "returning empty results to prevent cross-user data leak.",
            user_id,
        )
        return []

    logger.info(f"Executing hybrid search for query='{query[:50]}' user_id={norm_uid}")

    embeddings_model = get_embeddings()
    client = get_qdrant_client()
    init_db()

    docs_and_scores = []
    try:
        vector_store = QdrantVectorStore(
            client=client,
            collection_name=settings.COLLECTION_NAME,
            embedding=embeddings_model,
        )

        # Build authoritative user isolation filter
        user_filter = build_user_filter(norm_uid)
        docs_and_scores = vector_store.similarity_search_with_score(
            query,
            k=candidate_k,
            filter=user_filter,
        )
    except Exception as e:
        logger.error(f"Vector search exception: {e}")
        docs_and_scores = []

    # If no matches in user's documents, return empty immediately - NO GLOBAL FALLBACK!
    if not docs_and_scores:
        return []

    initial_candidates = []
    for doc, score in docs_and_scores:
        full_content = doc.metadata.get("parent_content") or doc.page_content
        initial_candidates.append({
            "content": full_content,
            "child_snippet": doc.page_content,
            "filename": doc.metadata.get("filename", "Unknown"),
            "page": doc.metadata.get("page", 1),
            "parent_id": doc.metadata.get("parent_id"),
            "vector_score": round(float(score), 4),
        })

    # Stage 1: Reciprocal Rank Fusion (Dense + BM25)
    fused_candidates = compute_reciprocal_rank_fusion(
        dense_results=initial_candidates,
        candidate_docs=initial_candidates,
        query=query,
    )
    for doc in fused_candidates:
        doc["rerank_score"] = doc.get("rrf_score", 0.0)

    # Stage 2: Deep Cross-Encoder Reranking (if enabled)
    if settings.ENABLE_CROSS_ENCODER:
        try:
            top_pool = fused_candidates[:min(len(fused_candidates), 15)]
            if top_pool:
                reranker = get_reranker()
                pairs = [[query, doc.get("child_snippet") or doc["content"][:400]] for doc in top_pool]
                rerank_scores = reranker.predict(pairs)

                for idx, score in enumerate(rerank_scores):
                    top_pool[idx]["rerank_score"] = round(float(score), 4)

                top_pool.sort(key=lambda x: x["rerank_score"], reverse=True)
                fused_candidates = top_pool + fused_candidates[len(top_pool):]
        except Exception as e:
            logger.debug(f"Cross-Encoder reranking note: {e}")

    # Stage 3: Multi-Hop Knowledge Graph Traversal & Provenance Fusion
    try:
        active_files = active_filenames
        if active_files is None:
            active_files = get_collection_stats(user_id=norm_uid).get("files", [])

        if active_files:
            graph_res = traverse_subgraph(query, user_id=norm_uid, active_filenames=active_files)
            if graph_res.get("contexts"):
                fused_candidates = graph_res["contexts"][:2] + fused_candidates
    except Exception as g_exc:
        logger.debug(f"Graph traversal note: {g_exc}")

    # Stage 4: Deduplicate by parent window to maximize topical diversity across target_k
    unique_candidates = []
    seen_parents = set()
    for doc in fused_candidates:
        parent_key = doc.get("parent_id") or doc.get("content")
        if parent_key not in seen_parents:
            seen_parents.add(parent_key)
            unique_candidates.append(doc)

    return unique_candidates[:target_k]
