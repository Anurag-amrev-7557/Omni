import os
import re
from functools import lru_cache
from rank_bm25 import BM25Okapi
from langchain_qdrant import QdrantVectorStore

# Restrict thread pools to avoid memory spikes on limited cloud instances
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"

try:
    from src.db import get_qdrant_client
    from src.config import COLLECTION_NAME
except ImportError:
    from db import get_qdrant_client
    from config import COLLECTION_NAME


@lru_cache(maxsize=1)
def get_embeddings():
    """Lazy-loaded memory-optimized HuggingFace embeddings."""
    try:
        import torch
        torch.set_num_threads(1)
    except Exception:
        pass
    from langchain_huggingface import HuggingFaceEmbeddings
    return HuggingFaceEmbeddings(
        model_name="all-MiniLM-L6-v2",
        model_kwargs={"device": "cpu"},
        encode_kwargs={"normalize_embeddings": True, "batch_size": 8}
    )


@lru_cache(maxsize=1)
def get_reranker():
    """Lazy-loaded lightweight Cross-Encoder with fallback."""
    try:
        import torch
        torch.set_num_threads(1)
        from sentence_transformers import CrossEncoder
        return CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2", device="cpu")
    except Exception as e:
        print(f"Notice: CrossEncoder reranker disabled to conserve memory ({e}). Using RRF.")
        return None


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

    # 2. Compute combined RRF score
    fused_docs = []
    for idx, doc in enumerate(candidate_docs):
        r_dense = dense_rank_map.get(idx, len(candidate_docs))
        r_bm25 = bm25_rank_map.get(idx, len(candidate_docs))
        
        # Weighted RRF: 0.6 Dense + 0.4 BM25
        rrf_score = (0.6 / (rrf_k + r_dense)) + (0.4 / (rrf_k + r_bm25))
        
        doc_copy = dict(doc)
        doc_copy["rrf_score"] = rrf_score
        fused_docs.append(doc_copy)

    # Sort descending by RRF score
    fused_docs.sort(key=lambda d: d["rrf_score"], reverse=True)
    return fused_docs


def rank_with_cross_encoder(query: str, candidate_docs: list[dict], top_n: int = 5) -> list[dict]:
    """Re-ranks top candidate documents using cross-encoder, with graceful fallback to RRF."""
    if not candidate_docs:
        return []

    reranker = get_reranker()
    if reranker is None:
        return candidate_docs[:top_n]

    try:
        pairs = [[query, doc["content"]] for doc in candidate_docs]
        scores = reranker.predict(pairs)
        
        scored_docs = []
        for i, doc in enumerate(candidate_docs):
            doc_copy = dict(doc)
            doc_copy["rerank_score"] = float(scores[i])
            scored_docs.append(doc_copy)
            
        scored_docs.sort(key=lambda x: x["rerank_score"], reverse=True)
        return scored_docs[:top_n]
    except Exception as e:
        print(f"Reranking error ({e}), falling back to RRF candidates.")
        return candidate_docs[:top_n]


def hybrid_search(query: str, k: int = 5) -> list[dict]:
    """Executes dense vector search and BM25 hybrid reciprocal rank fusion."""
    client = get_qdrant_client()
    embeddings_model = get_embeddings()

    vectorstore = QdrantVectorStore(
        client=client,
        collection_name=COLLECTION_NAME,
        embedding=embeddings_model,
    )

    # 1. Dense retrieval (k*2 candidates)
    candidate_limit = max(k * 2, 8)
    docs_with_scores = vectorstore.similarity_search_with_score(query, k=candidate_limit)

    if not docs_with_scores:
        return []

    candidate_docs = []
    dense_results = []
    for doc, score in docs_with_scores:
        entry = {
            "content": doc.page_content,
            "filename": doc.metadata.get("filename", "Unknown"),
            "page": doc.metadata.get("page", 1),
            "parent_content": doc.metadata.get("parent_content", doc.page_content),
            "summary": doc.metadata.get("summary", ""),
            "dense_score": float(score)
        }
        candidate_docs.append(entry)
        dense_results.append(entry)

    # 2. Reciprocal Rank Fusion (Dense + BM25)
    fused_docs = compute_reciprocal_rank_fusion(dense_results, candidate_docs, query)

    # 3. Stage 2: Deep Cross-Encoder Reranker
    reranked_docs = rank_with_cross_encoder(query, fused_docs, top_n=k)

    # 4. Deduplicate parent context blocks
    seen_parents = set()
    final_docs = []
    for doc in reranked_docs:
        parent_text = doc["parent_content"]
        if parent_text not in seen_parents:
            seen_parents.add(parent_text)
            final_docs.append(doc)

    return final_docs