"""Entity-Relation Property Graph (ERPG) Extraction and Semantic Deduplication Engine."""
import json
import re
from typing import Any

from src.config.settings import settings
from src.generation.llm import invoke_groq_with_fallback
from src.generation.prompts import GRAPH_EXTRACTION_PROMPT
from src.graph.db import batch_save_entities_and_relations

EXTRACTION_PROMPT = GRAPH_EXTRACTION_PROMPT.replace("{{", "{").replace("}}", "}")

# Recognized core entity types (open-domain extensions are also welcomed)
CORE_ENTITY_TYPES = {
    "Person", "Organization", "Technology", "System",
    "Document", "Role", "Skill", "Award", "Concept", "Process",
    "Component", "Location", "Domain"
}

TYPE_NORMALIZATION_MAP = {
    "individual": "Person",
    "human": "Person",
    "candidate": "Person",
    "student": "Person",
    "company": "Organization",
    "institution": "Organization",
    "university": "Organization",
    "college": "Organization",
    "agency": "Organization",
    "firm": "Organization",
    "role": "Role",
    "profession": "Role",
    "designation": "Role",
    "occupation": "Role",
    "position": "Role",
    "job": "Role",
    "skill": "Skill",
    "competency": "Skill",
    "degree": "Award",
    "diploma": "Award",
    "credential": "Award",
    "certification": "Award",
    "framework": "Technology",
    "language": "Technology",
    "library": "Technology",
    "database": "Technology",
    "tool": "Technology",
    "sdk": "Technology",
    "platform": "System",
    "service": "System",
    "application": "System",
    "app": "System",
    "certificate": "Document",
    "paper": "Document",
    "file": "Document",
    "resume": "Document",
    "invoice": "Document",
    "methodology": "Concept",
    "topic": "Concept",
    "domain": "Domain",
    "location": "Location",
    "city": "Location",
    "country": "Location",
    "hardware": "Component",
    "module": "Component",
    "workflow": "Process",
    "internship": "Role",
}


def canonicalize_name(name: str) -> str:
    """Normalizes entity names for semantic deduplication and entity resolution."""
    cleaned = name.strip().strip("\"'`")
    cleaned = re.sub(r'\s+', ' ', cleaned)
    cleaned = re.sub(r'[\.,;:]+$', '', cleaned).strip()

    # Strip honorifics
    cleaned = re.sub(r'^(?:Dr|Prof|Mr|Mrs|Ms|Hon|Sir|Dame|Rev)\.?\s+', '', cleaned, flags=re.IGNORECASE)

    # Strip degree suffixes
    cleaned = re.sub(r',?\s+(?:Ph\.?D\.?|M\.?D\.?|B\.?E\.?|B\.?Tech|M\.?Tech|MBA|Esq\.?)$', '', cleaned, flags=re.IGNORECASE)

    return cleaned.strip()


def split_implicit_role(raw_name: str) -> tuple[str, str | None]:
    """Separates atomic entity name from any attached role/designation suffix."""
    cname = canonicalize_name(raw_name)
    delim_match = re.match(r'^([A-Z][a-zA-Z\s\.\'-]{2,35}?)\s*(?:[-–—|]|\s+as\s+|\s+at\s+)\s*([A-Z][a-zA-Z0-9\s/&_-]{2,50})$', cname)
    if delim_match:
        cand_name, cand_role = delim_match.group(1).strip(), delim_match.group(2).strip()
        if len(cand_name.split()) >= 2:
            return cand_name, cand_role

    paren_match = re.match(r'^([A-Z][a-zA-Z\s\.\'-]{2,35}?)\s*\(([A-Za-z0-9\s/&_-]{2,50})\)$', cname)
    if paren_match:
        cand_name, cand_role = paren_match.group(1).strip(), paren_match.group(2).strip()
        if len(cand_name.split()) >= 2:
            return cand_name, cand_role

    return cname, None


def normalize_entity_type(raw_type: str, name: str) -> str:
    """Normalizes raw entity types into clean TitleCase open-domain types, with common taxonomy mappings."""
    t = (raw_type or "").strip()
    if not t:
        return "Concept"

    lower_t = t.lower()

    for k, v in TYPE_NORMALIZATION_MAP.items():
        if k == lower_t or k in lower_t:
            return v

    lower_n = name.lower()
    if any(kw in lower_n for kw in ["python", "docker", "fastapi", "react", "next.js", "postgres", "sql", "jwt", "git", "api", "qdrant", "redis", "linux", "html", "css", "typescript", "javascript"]):
        return "Technology"

    clean_type = re.sub(r'[^a-zA-Z0-9_]', '', t.title())
    if len(clean_type) >= 2 and clean_type.lower() not in {"unknown", "misc", "other", "item", "thing", "tag", "entity"}:
        return clean_type

    return "Concept"


def extract_entities_and_relations(
    text: str,
    filename: str,
    page: int = 1,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Extracts ERPG entities and relations from a text chunk using high-accuracy LLM with schema validation and fallback."""
    if not text or len(text.strip()) < 40:
        return {"entities": [], "relations": []}

    prompt = (
        EXTRACTION_PROMPT
        .replace("{filename}", str(filename))
        .replace("{page}", str(page))
        .replace("{text}", str(text[:3000]))
    )

    extracted_json = None
    raw = invoke_groq_with_fallback(
        prompt,
        max_tokens=1500,
        temperature=0.0,
        models=settings.DEFAULT_LLM_MODELS,
    )
    if raw:
        raw = re.sub(r'<think>[\s\S]*?</think>', '', raw).strip()
        raw = re.sub(r'^```(?:json)?\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw)

        json_match = re.search(r'\{[\s\S]*\}', raw)
        if json_match:
            try:
                extracted_json = json.loads(json_match.group(0))
            except json.JSONDecodeError:
                pass

    if not extracted_json or not isinstance(extracted_json, dict):
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
            is_tech = any(term in name.lower() for term in ["python", "docker", "fastapi", "react", "sql", "api", "git", "jwt", "qdrant", "postgres"])
            entities.append({
                "name": name,
                "type": "Technology" if is_tech else "Concept",
                "description": f"Extracted from {filename} (page {page})",
                "aliases": []
            })

        for i in range(len(entities) - 1):
            relations.append({
                "source": entities[i]["name"],
                "target": entities[i+1]["name"],
                "type": "RELATES_TO",
                "description": f"Associated in {filename}",
                "weight": 1.0
            })

    # Disambiguation, Cleansing & Batched Database Ingestion
    cleaned_entities = []
    seen_entity_names = set()
    implicit_relations = []

    for ent in entities:
        if not isinstance(ent, dict):
            continue
        raw_name = ent.get("name", "")
        if not raw_name:
            continue

        cname, implicit_role = split_implicit_role(raw_name)
        if not cname or len(cname) < 2:
            continue

        if cname.lower() in {"subject", "unknown", "document", "item", "page", "table", "figure"}:
            continue

        raw_type = ent.get("type", "Concept")
        norm_type = normalize_entity_type(raw_type, cname)

        if cname.lower() not in seen_entity_names:
            seen_entity_names.add(cname.lower())
            cleaned_entities.append({
                "name": cname,
                "type": norm_type,
                "description": ent.get("description", "").strip(),
                "aliases": [canonicalize_name(a) for a in ent.get("aliases", []) if a and canonicalize_name(a)],
            })

        if implicit_role and len(implicit_role) >= 2:
            clean_role = canonicalize_name(implicit_role)
            if clean_role.lower() not in seen_entity_names:
                seen_entity_names.add(clean_role.lower())
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

    all_relations = relations + implicit_relations
    valid_entity_names_lower = {e["name"].lower() for e in cleaned_entities}
    cleaned_relations = []
    seen_rel_keys = set()

    for rel in all_relations:
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

        if src.lower() not in valid_entity_names_lower:
            cleaned_entities.append({
                "name": src,
                "type": normalize_entity_type("Concept", src),
                "description": f"Referenced in {filename}",
                "aliases": [],
            })
            valid_entity_names_lower.add(src.lower())

        if tgt.lower() not in valid_entity_names_lower:
            cleaned_entities.append({
                "name": tgt,
                "type": normalize_entity_type("Concept", tgt),
                "description": f"Referenced in {filename}",
                "aliases": [],
            })
            valid_entity_names_lower.add(tgt.lower())

        rel_type = re.sub(r'[^A-Za-z0-9_]', '', rel.get("type", "RELATES_TO")).upper() or "RELATES_TO"
        rel_key = (src.lower(), tgt.lower(), rel_type)
        if rel_key in seen_rel_keys:
            continue
        seen_rel_keys.add(rel_key)

        cleaned_relations.append({
            "source": src,
            "target": tgt,
            "type": rel_type,
            "description": rel.get("description", "").strip(),
            "weight": float(rel.get("weight", 1.0)),
        })

    name_to_id, saved_count = batch_save_entities_and_relations(
        entities=cleaned_entities,
        relations=cleaned_relations,
        filename=filename,
        page=page,
        snippet=text[:300].strip(),
        user_id=user_id,
    )

    return {"entities": cleaned_entities, "relations": cleaned_relations}
