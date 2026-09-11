"""Entity-Relation Property Graph (ERPG) Extraction and Semantic Deduplication Engine."""
import json
import re
from typing import Any, Optional

from src.config.settings import settings
from src.core.logging import logger
from src.generation.llm import invoke_groq_with_fallback
from src.generation.prompts import GRAPH_EXTRACTION_PROMPT
from src.graph.db import (
    batch_save_entities_and_relations,
    delete_document_graph,
    run_entity_resolution_and_deduplication,
)

EXTRACTION_PROMPT = GRAPH_EXTRACTION_PROMPT.replace("{{", "{").replace("}}", "}")

TYPE_NORMALIZATION_MAP = {
    "individual": "Person", "human": "Person", "candidate": "Person", "student": "Person",
    "company": "Organization", "institution": "Organization", "university": "Organization",
    "college": "Organization", "agency": "Organization", "firm": "Organization",
    "role": "Role", "profession": "Role", "designation": "Role", "occupation": "Role",
    "position": "Role", "job": "Role", "internship": "Role",
    "skill": "Skill", "competency": "Skill",
    "degree": "Award", "diploma": "Award", "credential": "Award", "certification": "Award",
    "framework": "Technology", "language": "Technology", "library": "Technology",
    "database": "Technology", "tool": "Technology", "sdk": "Technology",
    "platform": "System", "service": "System", "application": "System", "app": "System",
    "certificate": "Document", "paper": "Document", "file": "Document",
    "resume": "Document", "invoice": "Document", "methodology": "Concept",
    "topic": "Concept", "domain": "Domain", "location": "Location", "city": "Location",
    "country": "Location", "hardware": "Component", "module": "Component", "workflow": "Process",
}

TECH_KEYWORDS = {"python", "docker", "fastapi", "react", "next.js", "postgres", "sql", "jwt", "git", "api", "qdrant", "redis", "linux", "html", "css", "typescript", "javascript"}


def canonicalize_name(name: str) -> str:
    """Normalizes entity names for semantic deduplication and entity resolution."""
    cleaned = re.sub(r'\s+', ' ', name.strip().strip("\"'`"))
    cleaned = re.sub(r'[\.,;:]+$', '', cleaned).strip()
    cleaned = re.sub(r'^(?:Dr|Prof|Mr|Mrs|Ms|Hon|Sir|Dame|Rev)\.?\s+', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r',?\s+(?:Ph\.?D\.?|M\.?D\.?|B\.?E\.?|B\.?Tech|M\.?Tech|MBA|Esq\.?)$', '', cleaned, flags=re.IGNORECASE)
    return cleaned.strip()


def split_implicit_role(raw_name: str) -> tuple[str, Optional[str]]:
    """Separates atomic entity name from any attached role/designation suffix."""
    cname = canonicalize_name(raw_name)
    m = re.match(r'^([A-Z][a-zA-Z\s\.\'-]{2,35}?)\s*(?:[-–—|]|\s+as\s+|\s+at\s+|\()([A-Za-z0-9\s/&_-]{2,50})\)?$', cname)
    if m:
        cand_name, cand_role = m.group(1).strip(), m.group(2).strip()
        if len(cand_name.split()) >= 2:
            return cand_name, cand_role
    return cname, None


def normalize_entity_type(raw_type: str, name: str) -> str:
    """Normalizes raw entity types into clean TitleCase open-domain types."""
    t = (raw_type or "").strip()
    if not t:
        return "Concept"
    lower_t = t.lower()
    for k, v in TYPE_NORMALIZATION_MAP.items():
        if k in lower_t:
            return v
    if any(kw in name.lower() for kw in TECH_KEYWORDS):
        return "Technology"
    clean_type = re.sub(r'[^a-zA-Z0-9_]', '', t.title())
    if len(clean_type) >= 2 and clean_type.lower() not in {"unknown", "misc", "other", "item", "thing", "tag", "entity"}:
        return clean_type
    return "Concept"


def extract_entities_and_relations(
    text: str,
    filename: str,
    page: int = 1,
    user_id: Optional[str] = None,
) -> dict[str, Any]:
    """Extracts ERPG entities and relations from a text chunk using LLM with regex fallback."""
    if not text or len(text.strip()) < 40:
        return {"entities": [], "relations": []}

    prompt = (
        EXTRACTION_PROMPT
        .replace("{filename}", str(filename))
        .replace("{page}", str(page))
        .replace("{text}", str(text[:5000]))
    )

    extracted_json = None
    raw = invoke_groq_with_fallback(
        prompt,
        max_tokens=2200,
        temperature=0.0,
        models=settings.DEFAULT_LLM_MODELS,
    )
    if raw:
        clean_raw = re.sub(r'<think>[\s\S]*?</think>', '', raw).strip()
        clean_raw = re.sub(r'^```(?:json)?\s*', '', clean_raw)
        clean_raw = re.sub(r'\s*```$', '', clean_raw)
        json_match = re.search(r'\{[\s\S]*\}', clean_raw)
        if json_match:
            try:
                extracted_json = json.loads(json_match.group(0))
            except json.JSONDecodeError:
                pass

        # If full JSON parse failed (e.g. truncated at token boundary), attempt recovery
        if not isinstance(extracted_json, dict) or not extracted_json.get("entities"):
            last_brace = clean_raw.rfind("}")
            if last_brace > 0:
                cand = clean_raw[:last_brace + 1]
                for suffix in ["]}", "}"]:
                    try:
                        recovered = json.loads(cand + suffix)
                        if isinstance(recovered, dict) and recovered.get("entities"):
                            extracted_json = recovered
                            break
                    except Exception:
                        pass

        # Secondary recovery: regex salvage of any complete entity and relation dicts
        if not isinstance(extracted_json, dict) or not extracted_json.get("entities"):
            entities_salvaged = []
            relations_salvaged = []
            for em in re.finditer(
                r'\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"type"\s*:\s*"([^"]+)"(?:[^}]*?"description"\s*:\s*"([^"]*)")?[^}]*\}',
                clean_raw,
            ):
                entities_salvaged.append({
                    "name": em.group(1),
                    "type": em.group(2),
                    "description": em.group(3) or "",
                    "aliases": [],
                })
            for rm in re.finditer(
                r'\{\s*"source"\s*:\s*"([^"]+)"\s*,\s*"target"\s*:\s*"([^"]+)"\s*,\s*"type"\s*:\s*"([^"]+)"(?:[^}]*?"description"\s*:\s*"([^"]*)")?[^}]*\}',
                clean_raw,
            ):
                relations_salvaged.append({
                    "source": rm.group(1),
                    "target": rm.group(2),
                    "type": rm.group(3),
                    "description": rm.group(4) or "",
                    "weight": 1.0,
                })
            if entities_salvaged:
                extracted_json = {"entities": entities_salvaged, "relations": relations_salvaged}

    if not isinstance(extracted_json, dict):
        extracted_json = {"entities": [], "relations": []}

    entities = extracted_json.get("entities", [])
    relations = extracted_json.get("relations", [])

    # Heuristic Rule-Based Fallback ONLY if LLM extraction returned 0 entities
    if not entities:
        candidates = list(dict.fromkeys(re.findall(r'\b[A-Z][A-Za-z0-9_-]{2,}(?:\s+[A-Z][A-Za-z0-9_-]{2,})*\b', text)))
        stopwords = {
            "This", "That", "There", "Here", "With", "From", "Your", "Please",
            "Document", "Section", "Table", "Figure", "After", "Before", "When",
            "Where", "Which", "About", "Total", "Amount", "Invoice", "Number", "Date", "Page",
            "Subject", "Name", "Summary", "Details", "Skills", "Experience"
        }
        filtered = [c for c in candidates if c not in stopwords and len(c) > 2][:8]
        for name in filtered:
            is_tech = any(term in name.lower() for term in TECH_KEYWORDS)
            entities.append({
                "name": name,
                "type": "Technology" if is_tech else "Concept",
                "description": f"Extracted from {filename} (page {page})",
                "aliases": []
            })
        for i in range(len(entities) - 1):
            relations.append({
                "source": entities[i]["name"],
                "target": entities[i + 1]["name"],
                "type": "RELATES_TO",
                "description": f"Associated in {filename}",
                "weight": 1.0
            })

    cleaned_entities = []
    seen_names = set()
    implicit_relations = []

    for ent in entities:
        if not isinstance(ent, dict) or not ent.get("name"):
            continue
        cname, implicit_role = split_implicit_role(ent["name"])
        if not cname or len(cname) < 2 or cname.lower() in {"subject", "unknown", "document", "item", "page", "table", "figure"}:
            continue

        norm_type = normalize_entity_type(ent.get("type", "Concept"), cname)
        if cname.lower() not in seen_names:
            seen_names.add(cname.lower())
            cleaned_entities.append({
                "name": cname,
                "type": norm_type,
                "description": ent.get("description", "").strip(),
                "aliases": [canonicalize_name(a) for a in ent.get("aliases", []) if a and canonicalize_name(a)],
            })

        if implicit_role and len(implicit_role) >= 2:
            clean_role = canonicalize_name(implicit_role)
            if clean_role.lower() not in seen_names:
                seen_names.add(clean_role.lower())
                cleaned_entities.append({
                    "name": clean_role,
                    "type": "Role",
                    "description": f"Role associated with {cname}",
                    "aliases": [],
                })
            implicit_relations.append({
                "source": cname,
                "target": clean_role,
                "type": "HAS_ROLE",
                "description": f"{cname} holds role {clean_role}",
                "weight": 1.0,
            })

    valid_names = {e["name"].lower() for e in cleaned_entities}
    cleaned_relations = []
    seen_rel_keys = set()

    for rel in relations + implicit_relations:
        if not isinstance(rel, dict):
            continue
        src = canonicalize_name(rel.get("source", ""))
        tgt = canonicalize_name(rel.get("target", ""))
        src_clean, _ = split_implicit_role(src)
        tgt_clean, _ = split_implicit_role(tgt)
        src = src_clean or src
        tgt = tgt_clean or tgt

        if not src or not tgt or src.lower() == tgt.lower():
            continue

        for ep, ep_name in [(src, src.lower()), (tgt, tgt.lower())]:
            if ep_name not in valid_names:
                cleaned_entities.append({
                    "name": ep,
                    "type": normalize_entity_type("Concept", ep),
                    "description": f"Referenced in {filename}",
                    "aliases": [],
                })
                valid_names.add(ep_name)

        rel_type = re.sub(r'[^A-Za-z0-9_]', '', rel.get("type", "RELATES_TO")).upper() or "RELATES_TO"
        rel_key = (src.lower(), tgt.lower(), rel_type)
        if rel_key not in seen_rel_keys:
            seen_rel_keys.add(rel_key)
            cleaned_relations.append({
                "source": src,
                "target": tgt,
                "type": rel_type,
                "description": rel.get("description", "").strip(),
                "weight": float(rel.get("weight", 1.0)),
            })

    # Hierarchical Hub-and-Spoke Anchor Topology
    # Prevents starburst crowding by clustering technologies under their respective projects/organizations
    primary_persons = [e["name"] for e in cleaned_entities if e.get("type") == "Person"]
    anchor = primary_persons[0] if primary_persons else (cleaned_entities[0]["name"] if cleaned_entities else None)

    systems = [e for e in cleaned_entities if e.get("type") == "System"]
    orgs = [e for e in cleaned_entities if e.get("type") == "Organization"]
    hubs = systems + orgs

    lower_text = text.lower()
    hub_positions = []
    for h in hubs:
        hpos = lower_text.find(h["name"].lower())
        if hpos != -1:
            hub_positions.append((hpos, h))
    hub_positions.sort(key=lambda x: x[0])

    linked_pairs = {(r["source"].lower(), r["target"].lower()) for r in cleaned_relations}
    linked_names = {r["source"].lower() for r in cleaned_relations} | {r["target"].lower() for r in cleaned_relations}

    # Ensure projects & organizations are linked to the primary person anchor
    if anchor:
        for sys_ent in systems:
            s_name = sys_ent["name"]
            if (anchor.lower(), s_name.lower()) not in linked_pairs and (s_name.lower(), anchor.lower()) not in linked_pairs:
                cleaned_relations.append({
                    "source": anchor,
                    "target": s_name,
                    "type": "BUILT",
                    "description": f"{anchor} engineered {s_name} in {filename}",
                    "weight": 1.0,
                })
                linked_pairs.add((anchor.lower(), s_name.lower()))
                linked_names.add(s_name.lower())

        for org_ent in orgs:
            o_name = org_ent["name"]
            if (anchor.lower(), o_name.lower()) not in linked_pairs and (o_name.lower(), anchor.lower()) not in linked_pairs:
                rel_type = "STUDIED_AT" if ("institute" in o_name.lower() or "university" in o_name.lower() or "college" in o_name.lower()) else "WORKED_AT"
                cleaned_relations.append({
                    "source": anchor,
                    "target": o_name,
                    "type": rel_type,
                    "description": f"{anchor} associated with {o_name} in {filename}",
                    "weight": 1.0,
                })
                linked_pairs.add((anchor.lower(), o_name.lower()))
                linked_names.add(o_name.lower())

    # Anchor remaining orphan entities to their contextual project/org hub (or fallback to anchor)
    for ent in cleaned_entities:
        cname = ent["name"]
        if cname.lower() in linked_names or (anchor and cname.lower() == anchor.lower()):
            continue

        etype = ent.get("type", "Concept")
        assigned_source = None
        rel_verb = "ASSOCIATED_WITH"

        if etype in ("Technology", "Skill") and hub_positions:
            epos = lower_text.find(cname.lower())
            if epos != -1:
                best_hub = None
                best_dist = 999999
                for hpos, h in hub_positions:
                    dist = abs(hpos - epos)
                    if hpos <= epos and (epos - hpos) < 750:
                        if (epos - hpos) < best_dist:
                            best_dist = epos - hpos
                            best_hub = h
                if not best_hub:
                    for hpos, h in hub_positions:
                        dist = abs(hpos - epos)
                        if dist < 450 and dist < best_dist:
                            best_dist = dist
                            best_hub = h
                if best_hub:
                    assigned_source = best_hub["name"]
                    rel_verb = "USES_TECHNOLOGY"

        if not assigned_source:
            assigned_source = anchor
            rel_verb = "SKILLED_IN" if etype in ("Technology", "Skill") else "ASSOCIATED_WITH"

        if assigned_source and assigned_source.lower() != cname.lower():
            cleaned_relations.append({
                "source": assigned_source,
                "target": cname,
                "type": rel_verb,
                "description": f"{assigned_source} associated with {cname} in {filename}",
                "weight": 1.0,
            })
            linked_pairs.add((assigned_source.lower(), cname.lower()))
            linked_names.add(cname.lower())

    batch_save_entities_and_relations(
        entities=cleaned_entities,
        relations=cleaned_relations,
        filename=filename,
        page=page,
        snippet=text[:300].strip(),
        user_id=user_id,
    )

    return {"entities": cleaned_entities, "relations": cleaned_relations}


def extract_and_cluster(
    chunks: list,
    filename: str,
    user_id: str,
    clear_existing: bool = True,
    run_clustering: Optional[bool] = None,
) -> dict:
    """Extracts entities & relations from chunks, resolves entities, and detects communities."""
    from src.graph.clustering import run_community_detection_and_summaries

    if clear_existing:
        delete_document_graph(filename, user_id=user_id)

    entities_count = 0
    relations_count = 0

    def _process_chunk(chunk):
        page = chunk.metadata.get("page", 1) if hasattr(chunk, "metadata") and chunk.metadata else 1
        return extract_entities_and_relations(
            text=chunk.page_content,
            filename=filename,
            page=page,
            user_id=user_id,
        )

    import concurrent.futures
    if len(chunks) <= 1:
        results = [_process_chunk(c) for c in chunks]
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(5, len(chunks))) as executor:
            results = list(executor.map(_process_chunk, chunks))

    for res in results:
        entities_count += len(res.get("entities", []))
        relations_count += len(res.get("relations", []))

    run_entity_resolution_and_deduplication(user_id=user_id)

    should_cluster = run_clustering if run_clustering is not None else (entities_count > 2 or relations_count > 2)
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
