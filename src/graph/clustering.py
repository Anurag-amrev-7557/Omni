"""Hierarchical Community Detection (Louvain Modularity Optimization) and PageRank Centrality."""
import re
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

from src.config.settings import settings
from src.generation.llm import invoke_groq_with_fallback
from src.generation.prompts import COMMUNITY_SUMMARY_PROMPT
from src.core.auth import get_current_user
from src.graph.db import get_user_graph, update_entity_metrics, save_community_clusters


def compute_pagerank(nodes: list[dict], links: list[dict], iterations: int = 20, d: float = 0.85) -> dict[str, float]:
    """Computes PageRank centrality scores for all nodes."""
    num_nodes = len(nodes)
    if num_nodes == 0:
        return {}

    node_ids = [n["id"] for n in nodes]
    out_links = defaultdict(list)
    in_links = defaultdict(list)

    for link in links:
        src = link["source"]
        tgt = link["target"]
        out_links[src].append(tgt)
        in_links[tgt].append(src)

    # Initial PageRank
    pr = {nid: 1.0 / num_nodes for nid in node_ids}

    for _ in range(iterations):
        new_pr = {}
        dangling_sum = sum(pr[nid] for nid in node_ids if len(out_links[nid]) == 0)

        for nid in node_ids:
            incoming_sum = sum(pr[src] / len(out_links[src]) for src in in_links[nid] if len(out_links[src]) > 0)
            new_pr[nid] = (1 - d) / num_nodes + d * (incoming_sum + dangling_sum / num_nodes)
        pr = new_pr

    # Scale so average is around 1.0
    avg_val = sum(pr.values()) / max(1, len(pr))
    if avg_val > 0:
        pr = {nid: round(val / avg_val, 3) for nid, val in pr.items()}
    return pr


def detect_louvain_communities(nodes: list[dict], links: list[dict]) -> dict[str, int]:
    """Pure-Python Louvain community detection via modularity optimization."""
    node_ids = [n["id"] for n in nodes]
    if not node_ids:
        return {}

    # Initialize each node in its own community
    community = {nid: i for i, nid in enumerate(node_ids)}

    # Build adjacency
    adj = defaultdict(lambda: defaultdict(float))
    total_weight = 0.0

    for link in links:
        src = link["source"]
        tgt = link["target"]
        w = float(link.get("weight", 1.0))
        adj[src][tgt] += w
        adj[tgt][src] += w
        total_weight += w

    if total_weight == 0:
        return {nid: 0 for nid in node_ids}

    # Optimization loop
    m2 = 2.0 * total_weight
    node_degrees = {nid: sum(adj[nid].values()) for nid in node_ids}

    improved = True
    passes = 0
    while improved and passes < 10:
        improved = False
        passes += 1
        for nid in node_ids:
            current_comm = community[nid]
            best_comm = current_comm
            best_gain = 0.0

            # Calculate edge weights to neighbor communities
            comm_weights = defaultdict(float)
            for neighbor, weight in adj[nid].items():
                comm_weights[community[neighbor]] += weight

            # Modularity gain evaluation
            ki = node_degrees[nid]
            for target_comm, ki_in in comm_weights.items():
                sigma_tot = sum(node_degrees[k] for k in node_ids if community[k] == target_comm and k != nid)
                delta_q = ki_in - (sigma_tot * ki) / m2
                if delta_q > best_gain:
                    best_gain = delta_q
                    best_comm = target_comm

            if best_comm != current_comm:
                community[nid] = best_comm
                improved = True

    # Renumber communities consecutively from 0 to N-1
    unique_comms = sorted(list(set(community.values())))
    comm_map = {old: new for new, old in enumerate(unique_comms)}
    return {nid: comm_map[comm] for nid, comm in community.items()}


def nodes_by_id(nodes: list[dict], nid: str) -> str:
    for n in nodes:
        if n["id"] == nid:
            return n["name"]
    return "Entity"


def run_community_detection_and_summaries(user_id: str | None = None) -> dict:
    """Detects communities, calculates metrics, generates summaries, and updates database."""
    uid = user_id or get_current_user()
    graph = get_user_graph(user_id=uid)
    nodes = graph["nodes"]
    links = graph["links"]

    if not nodes:
        return {"status": "empty", "communities": []}

    # 1. PageRank & Degrees
    pagerank_scores = compute_pagerank(nodes, links)
    deg_map = defaultdict(int)
    for l in links:
        deg_map[l["source"]] += 1
        deg_map[l["target"]] += 1

    # 2. Louvain Communities
    comm_assignments = detect_louvain_communities(nodes, links)

    # 3. Batch Update Entities in DB
    entity_updates = []
    for n in nodes:
        nid = n["id"]
        entity_updates.append({
            "entity_id": nid,
            "community_id": comm_assignments.get(nid, 0),
            "degree": deg_map.get(nid, 0),
            "pagerank": pagerank_scores.get(nid, 1.0),
        })
    update_entity_metrics(entity_updates, user_id=uid)

    # 4. Generate Community Summaries Concurrently
    comms_grouped = defaultdict(list)
    for n in nodes:
        cid = comm_assignments.get(n["id"], 0)
        comms_grouped[cid].append(n)

    # Sort communities by size (largest first)
    sorted_comms = sorted(comms_grouped.items(), key=lambda item: len(item[1]), reverse=True)

    def process_single_community(item):
        cid, cnodes = item
        key_entity_names = [cn["name"] for cn in sorted(cnodes, key=lambda x: pagerank_scores.get(x["id"], 0), reverse=True)[:6]]
        title = f"{key_entity_names[0]} & Related Systems" if key_entity_names else f"Community {cid}"

        cnode_ids = {cn["id"] for cn in cnodes}
        crelations = [
            f"{l.get('type')}: ({nodes_by_id(nodes, l['source'])} -> {nodes_by_id(nodes, l['target'])})"
            for l in links if l["source"] in cnode_ids and l["target"] in cnode_ids
        ][:6]

        summary_text = f"Topical cluster focusing on {', '.join(key_entity_names)}."
        findings = [f"Interconnects {name}" for name in key_entity_names[:3]]

        # Only invoke LLM for significant clusters (3+ entities)
        if len(cnodes) >= 3 and key_entity_names:
            community_prompt = COMMUNITY_SUMMARY_PROMPT.format(
                title=title,
                entities=", ".join(key_entity_names),
                relations="; ".join(crelations) or "Hierarchically clustered concepts"
            )
            raw_summary = invoke_groq_with_fallback(
                community_prompt,
                max_tokens=250,
                temperature=0.2,
                models=settings.DEFAULT_LLM_MODELS,
                timeout=4.0,
            )
            if raw_summary:
                raw_summary = re.sub(r'<think>[\s\S]*?</think>', '', raw_summary).strip()
                if raw_summary:
                    summary_text = raw_summary
                    parsed_findings = [line.strip('- *') for line in raw_summary.split('\n') if line.strip().startswith('-')]
                    if parsed_findings:
                        findings = parsed_findings

        return {
            "community_id": cid,
            "level": 0,
            "title": title,
            "summary": summary_text,
            "key_entities": key_entity_names,
            "findings": findings[:4],
        }

    community_records = []
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(process_single_community, item) for item in sorted_comms[:8]]
        for future in as_completed(futures):
            try:
                res = future.result(timeout=6.0)
                community_records.append(res)
            except Exception as exc:
                pass

    # Add remaining small clusters with template summaries
    for cid, cnodes in sorted_comms[8:]:
        key_entity_names = [cn["name"] for cn in sorted(cnodes, key=lambda x: pagerank_scores.get(x["id"], 0), reverse=True)[:4]]
        title = f"{key_entity_names[0]} Group" if key_entity_names else f"Cluster {cid}"
        community_records.append({
            "community_id": cid,
            "level": 0,
            "title": title,
            "summary": f"Group of related entities: {', '.join(key_entity_names)}.",
            "key_entities": key_entity_names,
            "findings": [f"Contains {n}" for n in key_entity_names[:2]],
        })

    save_community_clusters(community_records, user_id=uid)
    return {"status": "success", "total_communities": len(community_records), "communities": community_records}
