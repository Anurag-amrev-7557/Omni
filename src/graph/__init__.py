"""Knowledge Graph Package: DB persistence, ERPG extraction, Louvain clustering, PageRank, and traversal."""
from src.graph.db import (
    get_db_connection,
    init_graph_db,
    upsert_entity,
    add_relation,
    batch_save_entities_and_relations,
    get_user_graph,
    save_community_clusters,
    update_entity_metrics,
    sync_and_prune_graph,
    run_entity_resolution_and_deduplication,
    delete_document_graph,
    clear_user_graph,
)
from src.graph.traversal import (
    traverse_subgraph,
    extract_query_keywords,
)
from src.graph.clustering import (
    compute_pagerank,
    detect_louvain_communities,
    run_community_detection_and_summaries,
)
from src.graph.extractor import (
    extract_entities_and_relations,
    canonicalize_name,
    normalize_entity_type,
    extract_and_cluster,
)

__all__ = [
    "get_db_connection",
    "init_graph_db",
    "upsert_entity",
    "add_relation",
    "batch_save_entities_and_relations",
    "get_user_graph",
    "save_community_clusters",
    "update_entity_metrics",
    "sync_and_prune_graph",
    "run_entity_resolution_and_deduplication",
    "delete_document_graph",
    "clear_user_graph",
    "traverse_subgraph",
    "extract_query_keywords",
    "compute_pagerank",
    "detect_louvain_communities",
    "run_community_detection_and_summaries",
    "extract_entities_and_relations",
    "canonicalize_name",
    "normalize_entity_type",
    "extract_and_cluster",
]
