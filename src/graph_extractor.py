"""Entity-Relation Property Graph (ERPG) Extraction and Semantic Deduplication Engine."""
import json
import re
from typing import Any
from langchain_groq import ChatGroq

EXTRACTION_PROMPT = """You are an expert Knowledge Graph and Ontology Engineer.
Extract key real-world entities and precise directed relationships from the text below.

OPEN-DOMAIN KNOWLEDGE ONTOLOGY:
1. Canonical Atomic Entity Names:
   - Always extract clean, atomic proper nouns for entities.
   - NEVER combine a person's or organization's name with their title, profession, designation, or degree (e.g. use 'Anurag Verma', NEVER 'Anurag Verma Software Engineer' or 'Dr. Jane Doe').
   - Human individuals MUST have type 'Person'.

2. Professions, Designations, Degrees, and Domains as First-Class Entities:
   - Do NOT ignore, drop, or discard job titles, professions, designations, degrees, or domain concepts!
   - Extract them as their own distinct entities (e.g., type 'Role' for 'Software Engineering Intern', 'Chief Medical Officer', 'Full Stack Developer'; type 'Award' or 'Degree' for 'B.Tech in Civil Engineering', 'Certificate of Completion'; type 'Domain' for 'Retrieval-Augmented Generation', 'Quantum Optics').
   - Create explicit directed relationships linking the person/entity to their role or domain:
     e.g.,
     Source: 'Anurag Verma' -> Target: 'Software Engineering Intern', Type: 'HAS_ROLE'
     Source: 'Anurag Verma' -> Target: 'Google Cloud India', Type: 'INTERNS_AT'
     Source: 'Google Cloud India' -> Target: 'Certificate of Completion', Type: 'ISSUES'
     Source: 'Anurag Verma' -> Target: 'Certificate of Completion', Type: 'AWARDED'

3. Open-Domain Entity Types:
   - Use descriptive TitleCase types suited to the text domain:
     - Core: Person, Organization, Technology, System, Document, Role, Skill, Location, Award, Concept, Process, Component
     - Domain Extensions: Domain, Field, MedicalCondition, LegalClause, Metric, Event, Credential, Dataset, etc.

4. Expressive Directed Relationships:
   - Relationships must be UPPER_SNAKE_CASE expressing semantic verbs grounded in the text:
     'WORKS_AT', 'INTERNS_AT', 'STUDIES_AT', 'HAS_ROLE', 'PROFICIENT_IN', 'BUILT', 'ISSUED_BY', 'AWARDED',
     'AUTHORED', 'LOCATED_IN', 'PART_OF', 'SPECIALIZES_IN', 'COLLABORATES_WITH', 'DEPENDS_ON', 'INTEGRATES_WITH',
     'CONTAINS', 'RELATES_TO'.

5. Cross-Document Entity Unification:
   - Extract consistent atomic canonical names for entities (e.g. 'Anurag Verma') so they unify into a coherent knowledge graph across documents.

Return ONLY a valid raw JSON object. No Markdown code fences, no explanations, no text before or after.

Output Schema:
{
  "entities": [
    {
      "name": "Canonical Name",
      "type": "Person",
      "description": "Short 1-sentence description",
      "aliases": []
    }
  ],
  "relations": [
    {
      "source": "Source Entity Name",
      "target": "Target Entity Name",
      "type": "RELATION_TYPE",
      "description": "Short explanation of the relationship",
      "weight": 1.0
    }
  ]
}

Text Chunk (from document '{filename}', page {page}):
\"\"\"
{text}
\"\"\"
"""

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
    # Check for "Name - Role" or "Name | Role" or "Name as Role"
    delim_match = re.match(r'^([A-Z][a-zA-Z\s\.\'-]{2,35}?)\s*(?:[-–—|]|\s+as\s+|\s+at\s+)\s*([A-Z][a-zA-Z0-9\s/&_-]{2,50})$', cname)
    if delim_match:
        cand_name, cand_role = delim_match.group(1).strip(), delim_match.group(2).strip()
        if len(cand_name.split()) >= 2:
            return cand_name, cand_role
            
    # Check for "Name (Role)"
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

    # Exact or substring match in normalization map
    for k, v in TYPE_NORMALIZATION_MAP.items():
        if k == lower_t or k in lower_t:
            return v

    # Check common technology keywords in name
    lower_n = name.lower()
    if any(kw in lower_n for kw in ["python", "docker", "fastapi", "react", "next.js", "postgres", "sql", "jwt", "git", "api", "qdrant", "redis", "linux", "html", "css", "typescript", "javascript"]):
        return "Technology"

    # Open-domain fallback: preserve any clean alphanumeric TitleCase domain type!
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
    # High-accuracy instruction-following models on Groq
    models_to_try = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b", "qwen/qwen3.6-27b"]
    
    for model in models_to_try:
        try:
            llm = ChatGroq(model=model, temperature=0.0)
            res = llm.invoke(prompt)
            raw = res.content
            # Remove any reasoning/thinking traces
            raw = re.sub(r'<think>[\s\S]*?</think>', '', raw).strip()
            # Strip markdown code blocks
            raw = re.sub(r'^```(?:json)?\s*', '', raw)
            raw = re.sub(r'\s*```$', '', raw)
            
            # Find the largest matching JSON object
            json_match = re.search(r'\{[\s\S]*\}', raw)
            if json_match:
                extracted_json = json.loads(json_match.group(0))
                if isinstance(extracted_json, dict) and "entities" in extracted_json:
                    break
        except Exception:
            continue

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
            
        # Filter out generic stop labels
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

        # If an implicit role or designation was attached to the name, preserve it as a Role entity!
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

    # Combine relations with any extracted implicit role relations
    all_relations = relations + implicit_relations

    valid_entity_names_lower = {e["name"].lower() for e in cleaned_entities}
    cleaned_relations = []
    seen_rel_keys = set()

    for rel in all_relations:
        if not isinstance(rel, dict):
            continue
        src = canonicalize_name(rel.get("source", ""))
        tgt = canonicalize_name(rel.get("target", ""))

        # Check if source or target had an implicit role attached
        src_clean, _ = split_implicit_role(src)
        tgt_clean, _ = split_implicit_role(tgt)
        src = src_clean or src
        tgt = tgt_clean or tgt
        
        if not src or not tgt or src.lower() == tgt.lower():
            continue
            
        # Ensure both endpoints exist in extracted entities or add placeholder
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

    from src.graph_db import batch_save_entities_and_relations
    name_to_id, saved_count = batch_save_entities_and_relations(
        entities=cleaned_entities,
        relations=cleaned_relations,
        filename=filename,
        page=page,
        snippet=text[:300].strip(),
        user_id=user_id,
    )

    return {"entities": cleaned_entities, "relations": cleaned_relations}

