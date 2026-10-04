"""Multi-Hop Graph Traversal and Provenance Reasoning Engine."""
import re
from src.core.logging import logger
from src.graph.db import get_user_graph


_EMPTY_RESULT = {"contexts": [], "provenance": [], "subgraph": {"nodes": [], "links": []}}


def extract_query_keywords(query: str) -> list[str]:
    """Extracts candidate entity search tokens from a user query."""
    words = [w.lower() for w in re.sub(r'[^\w\s-]', ' ', query).split()]
    tokens = [w for w in words if len(w) > 2]
    bigrams = [f"{words[i]} {words[i+1]}" for i in range(len(words) - 1) if len(words[i]) > 2]
    return list(set(tokens + bigrams))


def traverse_subgraph(
    query: str,
    max_hops: int = 2,
    max_entities: int = 8,
    user_id: str | None = None,
    active_filenames: list[str] | None = None,
) -> dict:
    """Traverses knowledge graph around query seed entities and returns grounded paths & provenance."""
    logger.info(f"Traversing knowledge graph for query='{query[:50]}' user_id={user_id}")
    graph = get_user_graph(user_id=user_id, active_filenames=active_filenames)
    nodes = graph.get("nodes", [])
    links = graph.get("links", [])

    if not nodes or not links:
        return _EMPTY_RESULT

    keywords = extract_query_keywords(query)

    matched_nodes = []
    for n in nodes:
        name_lower = n["name"].lower()
        desc_lower = (n.get("description") or "").lower()
        aliases_lower = [a.lower() for a in n.get("aliases", [])]

        score = sum(
            5 if kw == name_lower else
            4 if any(kw == a for a in aliases_lower) else
            3 if kw in name_lower else
            1 if kw in desc_lower else 0
            for kw in keywords
        )
        if score > 0:
            matched_nodes.append((score, n))

    matched_nodes.sort(key=lambda x: (x[0], x[1].get("pagerank", 1.0)), reverse=True)
    seed_nodes = [n for _, n in matched_nodes[:max_entities]]

    if not seed_nodes:
        return _EMPTY_RESULT

    seed_ids = {n["id"] for n in seed_nodes}
    visited_node_ids = set(seed_ids)
    active_links = []
    provenance_hops = []

    nodes_map = {n["id"]: n for n in nodes}

    current_frontier = set(seed_ids)
    for hop in range(1, max_hops + 1):
        next_frontier = set()
        for link in links:
            src = link["source"]
            tgt = link["target"]

            if src in current_frontier or tgt in current_frontier:
                active_links.append(link)
                other_id = tgt if src in current_frontier else src

                src_node = nodes_map.get(src)
                tgt_node = nodes_map.get(tgt)

                if src_node and tgt_node:
                    provenance_hops.append({
                        "hop": hop,
                        "source": src_node["name"],
                        "target": tgt_node["name"],
                        "relation": link.get("type", "RELATES_TO"),
                        "description": link.get("description", ""),
                        "source_doc": link.get("source_doc", ""),
                        "page": link.get("page_num", 1),
                        "snippet": link.get("snippet", ""),
                    })

                if other_id not in visited_node_ids:
                    visited_node_ids.add(other_id)
                    next_frontier.add(other_id)

        current_frontier = next_frontier
        if not current_frontier:
            break

    graph_contexts = []
    for h in provenance_hops[:6]:
        snippet_text = (
            f"[Knowledge Graph Relation] Entity '{h['source']}' {h['relation']} '{h['target']}'"
            + (f": {h['description']}" if h['description'] else "")
            + (f" (Evidence: {h['snippet']})" if h['snippet'] else "")
        )
        graph_contexts.append({
            "filename": h["source_doc"] or "Knowledge Graph",
            "page": h["page"],
            "content": snippet_text,
            "parent_content": snippet_text,
            "rerank_score": 0.95,
            "is_graph_relation": True,
            "graph_hop": h,
        })

    subgraph_nodes = [nodes_map[nid] for nid in visited_node_ids if nid in nodes_map]

    return {
        "contexts": graph_contexts,
        "provenance": provenance_hops,
        "subgraph": {
            "nodes": subgraph_nodes,
            "links": active_links,
        }
    }
