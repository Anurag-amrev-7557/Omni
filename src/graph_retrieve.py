"""Multi-Hop Graph Traversal and Provenance Reasoning Engine."""
import re
from src.graph_db import get_user_graph

def extract_query_keywords(query: str) -> list[str]:
    """Extracts candidate entity search tokens from a user query."""
    cleaned = re.sub(r'[^\w\s-]', ' ', query)
    tokens = [t.strip().lower() for t in cleaned.split() if len(t.strip()) > 2]
    # Also include 2-word n-grams
    words = cleaned.split()
    bigrams = [f"{words[i]} {words[i+1]}".strip().lower() for i in range(len(words)-1) if len(words[i]) > 2]
    return list(set(tokens + bigrams))

def traverse_subgraph(query: str, max_hops: int = 2, max_entities: int = 8) -> dict:
    """Traverses knowledge graph around query seed entities and returns grounded paths & provenance."""
    graph = get_user_graph()
    nodes = graph.get("nodes", [])
    links = graph.get("links", [])

    if not nodes or not links:
        return {"contexts": [], "provenance": [], "subgraph": {"nodes": [], "links": []}}

    keywords = extract_query_keywords(query)
    
    # Match Seed Entities
    matched_nodes = []
    for n in nodes:
        name_lower = n["name"].lower()
        desc_lower = (n.get("description") or "").lower()
        aliases_lower = [a.lower() for a in n.get("aliases", [])]
        
        score = 0
        for kw in keywords:
            if kw == name_lower:
                score += 5
            elif kw in name_lower:
                score += 3
            elif any(kw == a for a in aliases_lower):
                score += 4
            elif kw in desc_lower:
                score += 1

        if score > 0:
            matched_nodes.append((score, n))

    matched_nodes.sort(key=lambda x: (x[0], x[1].get("pagerank", 1.0)), reverse=True)
    seed_nodes = [n for _, n in matched_nodes[:max_entities]]

    if not seed_nodes:
        return {"contexts": [], "provenance": [], "subgraph": {"nodes": [], "links": []}}

    seed_ids = {n["id"] for n in seed_nodes}
    visited_node_ids = set(seed_ids)
    active_links = []
    provenance_hops = []

    # Map node lookup
    nodes_map = {n["id"]: n for n in nodes}

    # 1-Hop and 2-Hop Traversal
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

    # Build Graph Context Chunks for LLM prompt augmentation
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
