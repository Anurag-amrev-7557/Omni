"""Reciprocal Rank Fusion (RRF) combining Dense and BM25 lexical ranking."""
import re
from typing import List, Dict, Any, Optional
from rank_bm25 import BM25Okapi

from src.config.settings import settings


def tokenize_text(text: str) -> List[str]:
    """Tokenizes alphanumeric terms and lowercase words for BM25 indexing."""
    return re.findall(r"\w+", text.lower())


def compute_reciprocal_rank_fusion(
    dense_results: List[Dict[str, Any]],
    candidate_docs: List[Dict[str, Any]],
    query: str,
    rrf_k: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Combines dense vector retrieval ranks with BM25 lexical ranks using Reciprocal Rank Fusion (RRF).

    RRF_Score(d) = dense_weight / (k + rank_dense) + sparse_weight / (k + rank_bm25)
    """
    if not candidate_docs:
        return []

    k_val = rrf_k or settings.RRF_K
    dense_weight = settings.RRF_DENSE_WEIGHT
    sparse_weight = settings.RRF_SPARSE_WEIGHT

    tokenized_corpus = [tokenize_text(doc.get("content", "")) for doc in candidate_docs]
    tokenized_query = tokenize_text(query)

    bm25 = BM25Okapi(tokenized_corpus)
    bm25_scores = bm25.get_scores(tokenized_query) if tokenized_query else [0.0] * len(candidate_docs)

    bm25_ranked = sorted(
        enumerate(candidate_docs),
        key=lambda pair: bm25_scores[pair[0]],
        reverse=True,
    )
    bm25_rank_map = {doc_idx: rank + 1 for rank, (doc_idx, _) in enumerate(bm25_ranked)}
    dense_rank_map = {idx: rank + 1 for rank, idx in enumerate(range(len(dense_results)))}

    fused_candidates = []
    for idx, doc in enumerate(candidate_docs):
        d_rank = dense_rank_map.get(idx, len(candidate_docs) + 1)
        b_rank = bm25_rank_map.get(idx, len(candidate_docs) + 1)

        dense_rrf = dense_weight * (1.0 / (k_val + d_rank))
        bm25_rrf = sparse_weight * (1.0 / (k_val + b_rank))
        rrf_score = round(dense_rrf + bm25_rrf, 6)

        item = dict(doc)
        item["dense_rank"] = d_rank
        item["bm25_rank"] = b_rank
        item["bm25_score"] = round(float(bm25_scores[idx]), 4)
        item["rrf_score"] = rrf_score
        fused_candidates.append(item)

    fused_candidates.sort(key=lambda x: x["rrf_score"], reverse=True)
    return fused_candidates
