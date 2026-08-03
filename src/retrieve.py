import re
from functools import lru_cache
from rank_bm25 import BM25Okapi
from langchain_qdrant import QdrantVectorStore
try:
    from src.db import get_qdrant_client, init_db
    from src.config import COLLECTION_NAME
except ImportError:
    from db import get_qdrant_client, init_db
    from config import COLLECTION_NAME


@lru_cache(maxsize=1)
def get_embeddings():
    """Lazy loader for embeddings. Prefers FastEmbed (lightweight ONNX runtime, ~90MB) with HuggingFace fallback."""
    try:
        from langchain_community.embeddings.fastembed import FastEmbedEmbeddings
        return FastEmbedEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
    except Exception:
        from langchain_huggingface import HuggingFaceEmbeddings
        return HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")


@lru_cache(maxsize=1)
def get_reranker():
    """Lazy loader for cross-encoder reranker to avoid loading PyTorch during server startup."""
    from sentence_transformers import CrossEncoder
    return CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")


def tokenize_text(text: str) -> list[str]:
    """Tokenizes alphanumeric terms and lowercase words for BM25 indexing."""
    return re.findall(r"\w+", text.lower())


def compute_reciprocal_rank_fusion(
    dense_results: list[dict],
    candidate_docs: list[dict],
    query: str,
    rrf_k: int = 60
) -> list[dict]:
    """
    Combines dense vector retrieval ranks with BM25 lexical ranks using Reciprocal Rank Fusion (RRF).
    RRF_Score(d) = sum( 1 / (rrf_k + rank_i(d)) )
    """
    if not candidate_docs:
        return []

    # 1. Compute BM25 scores over candidate corpus
    tokenized_corpus = [tokenize_text(doc["content"]) for doc in candidate_docs]
    tokenized_query = tokenize_text(query)
    
    bm25 = BM25Okapi(tokenized_corpus)
    bm25_scores = bm25.get_scores(tokenized_query) if tokenized_query else [0.0] * len(candidate_docs)
    
    # Pair and rank by BM25
    bm25_ranked = sorted(
        enumerate(candidate_docs),
        key=lambda pair: bm25_scores[pair[0]],
        reverse=True
    )
    bm25_rank_map = {doc_idx: rank + 1 for rank, (doc_idx, _) in enumerate(bm25_ranked)}

    # Map dense ranks
    dense_rank_map = {idx: rank + 1 for rank, idx in enumerate(range(len(dense_results)))}

    fused_candidates = []
    for idx, doc in enumerate(candidate_docs):
        d_rank = dense_rank_map.get(idx, len(candidate_docs) + 1)
        b_rank = bm25_rank_map.get(idx, len(candidate_docs) + 1)
        
        # RRF formula: 0.6 dense weight + 0.4 BM25 weight
        dense_rrf = 0.6 * (1.0 / (rrf_k + d_rank))
        bm25_rrf = 0.4 * (1.0 / (rrf_k + b_rank))
        rrf_score = round(dense_rrf + bm25_rrf, 6)
        
        item = dict(doc)
        item["dense_rank"] = d_rank
        item["bm25_rank"] = b_rank
        item["bm25_score"] = round(float(bm25_scores[idx]), 4)
        item["rrf_score"] = rrf_score
        fused_candidates.append(item)

    fused_candidates.sort(key=lambda x: x["rrf_score"], reverse=True)
    return fused_candidates


def hybrid_search(query: str, k: int = 5, user_id: str | None = None, limit: int | None = None, **kwargs) -> list[dict]:
    """Executes dense vector search and BM25 hybrid reciprocal rank fusion with Cross-Encoder reranking."""
    if limit is not None:
        k = limit
    candidate_k = max(k * 2, 8)
    embeddings_model = get_embeddings()
    client = get_qdrant_client()
    init_db()
    try:
        vector_store = QdrantVectorStore(
            client=client,
            collection_name=COLLECTION_NAME,
            embedding=embeddings_model,
        )

        try:
            from src.auth import get_current_user
            uid = user_id or get_current_user()
        except Exception:
            uid = user_id

        if uid and uid not in ("default_user", "00000000-0000-0000-0000-000000000000"):
            from qdrant_client.models import Filter, FieldCondition, MatchValue
            user_filter = Filter(
                should=[
                    FieldCondition(key="metadata.user_id", match=MatchValue(value=uid)),
                    FieldCondition(key="user_id", match=MatchValue(value=uid)),
                ]
            )
            docs_and_scores = vector_store.similarity_search_with_score(query, k=candidate_k, filter=user_filter)
            if not docs_and_scores:
                docs_and_scores = vector_store.similarity_search_with_score(query, k=candidate_k)
        else:
            docs_and_scores = vector_store.similarity_search_with_score(query, k=candidate_k)
    except Exception as e:
        print(f"Vector search exception: {e}")
        docs_and_scores = []

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
            "vector_score": round(float(score), 4),
        })

    # Stage 1: Reciprocal Rank Fusion (Dense + BM25)
    fused_candidates = compute_reciprocal_rank_fusion(
        dense_results=initial_candidates,
        candidate_docs=initial_candidates,
        query=query
    )
    for doc in fused_candidates:
        doc["rerank_score"] = doc.get("rrf_score", 0.0)

    # Stage 2: Deep Cross-Encoder Reranking (Opt-in via ENABLE_CROSS_ENCODER to maintain sub-second latency)
    import os
    if os.getenv("ENABLE_CROSS_ENCODER", "false").lower() in ("true", "1", "yes"):
        try:
            top_pool = fused_candidates[:min(len(fused_candidates), 6)]
            if top_pool:
                reranker = get_reranker()
                pairs = [[query, doc.get("child_snippet") or doc["content"][:400]] for doc in top_pool]
                rerank_scores = reranker.predict(pairs)

                for idx, score in enumerate(rerank_scores):
                    top_pool[idx]["rerank_score"] = round(float(score), 4)

                top_pool.sort(key=lambda x: x["rerank_score"], reverse=True)
                fused_candidates = top_pool + fused_candidates[len(top_pool):]
        except Exception as e:
            print(f"Cross-Encoder reranking note: {e}")

    # Stage 3: Multi-Hop Knowledge Graph Traversal & Provenance Fusion
    try:
        from src.graph_retrieve import traverse_subgraph
        from src.db import get_collection_stats
        active_files = get_collection_stats().get("files", [])
        graph_res = traverse_subgraph(query, user_id=user_id, active_filenames=active_files)
        if graph_res.get("contexts"):
            fused_candidates = graph_res["contexts"][:2] + fused_candidates
    except Exception as g_exc:
        pass

    return fused_candidates[:limit]