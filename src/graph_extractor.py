"""Entity-Relation Property Graph (ERPG) Extraction and Semantic Deduplication Engine."""
import json
import re
from typing import Any
from langchain_groq import ChatGroq

EXTRACTION_PROMPT = """You are an expert Knowledge Graph and Ontology Engineer.
Extract the key real-world entities and precise directed relationships from the text below.

STRICT ONTOLOGY SPECIFICATION:
Allowed Entity Types:
- Person: Human individuals (e.g., 'Anurag Verma', 'Linus Torvalds'). NEVER classify an individual person's name as Technology, Concept, or Organization!
- Organization: Companies, universities, institutions, agencies (e.g., 'Google', 'Google Cloud India', 'IIT Bhubaneswar', 'Stripe', 'LangChain Academy').
- Technology: Programming languages, frameworks, libraries, developer tools, databases, protocols (e.g., 'Python', 'FastAPI', 'Docker', 'PostgreSQL', 'JWT', 'React').
- System: Software applications, microservices, platforms, products (e.g., 'Polling Platform', 'Knowledge Vault', 'Mapfolio').
- Document: Certificates, resumes, invoices, licenses, reports (e.g., 'Internship Certificate', 'Tax Invoice', 'Resume').
- Concept: Methodologies, domains, abstract theories, architectural paradigms (e.g., 'Microservices Architecture', 'RAG', 'Retrieval-Augmented Generation').
- Process: Roles, degrees, internships, structured workflows (e.g., 'Software Engineering Internship', 'B.Tech in Civil Engineering').
- Component: Physical or logical hardware/software modules, audio gear line items (e.g., 'FiiO BTR11', 'TANGZU Waner SG 2').

Allowed Relationship Types:
- Person <-> Organization: 'WORKS_AT', 'INTERNS_AT', 'STUDIES_AT', 'FOUNDED', 'MEMBER_OF'
- Person <-> Technology / System: 'USES', 'PROFICIENT_IN', 'BUILT', 'MAINTAINS'
- Person <-> Document / Process: 'COMPLETED', 'AWARDED', 'AUTHORS', 'EARNED'
- Organization <-> Document / Process: 'ISSUES', 'HOSTS', 'OFFERS'
- Technology / System <-> Technology / System: 'DEPENDS_ON', 'INTEGRATES_WITH', 'BUILT_WITH', 'DEPLOYS_TO'
- General: 'CONTAINS', 'PART_OF', 'RELATES_TO'

RULES:
1. Canonical Name: Extract clean, succinct proper nouns. Strip titles or roles from person names (e.g., use 'Anurag Verma', NOT 'Anurag Verma Software Engineer' or 'Subject').
2. Person Typing: Any human individual's name MUST be typed as 'Person'.
3. Relationships: Directed source -> target relations must be logically accurate, meaningful, and factually grounded in the text.
4. Output Format: Return ONLY a valid raw JSON object. No Markdown code fences, no explanations, no text before or after.

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

# Recognized entity types
VALID_ENTITY_TYPES = {
    "Person", "Organization", "Technology", "System",
    "Document", "Concept", "Process", "Component"
}

TYPE_NORMALIZATION_MAP = {
    "individual": "Person",
    "human": "Person",
    "candidate": "Person",
    "student": "Person",
    "engineer": "Person",
    "company": "Organization",
    "institution": "Organization",
    "university": "Organization",
    "college": "Organization",
    "framework": "Technology",
    "language": "Technology",
    "library": "Technology",
    "database": "Technology",
    "tool": "Technology",
    "platform": "System",
    "service": "System",
    "application": "System",
    "app": "System",
    "certificate": "Document",
    "paper": "Document",
    "file": "Document",
    "role": "Process",
    "internship": "Process",
    "education": "Process",
    "degree": "Process",
    "methodology": "Concept",
    "topic": "Concept",
    "domain": "Concept",
}

PERSON_ROLE_PATTERNS = [
    r"Software\s+Engineering\s+Intern",
    r"Software\s+Engineer",
    r"Software\s+Developer",
    r"Full[- ]Stack\s+Developer",
    r"Full[- ]Stack\s+Engineer",
    r"Backend\s+Developer",
    r"Frontend\s+Developer",
    r"Data\s+Scientist",
    r"AI\s+Engineer",
    r"Intern",
    r"Student",
    r"Consultant",
    r"Researcher",
    r"Architect",
    r"Lead",
    r"Manager",
]

def canonicalize_name(name: str) -> str:
    """Normalizes entity names for semantic deduplication and entity resolution."""
    cleaned = name.strip().strip("\"'`")
    cleaned = re.sub(r'\s+', ' ', cleaned)
    cleaned = re.sub(r'[\.,;:]+$', '', cleaned).strip()
    
    # Strip honorifics
    cleaned = re.sub(r'^(?:Dr|Prof|Mr|Mrs|Ms)\.?\s+', '', cleaned, flags=re.IGNORECASE)

    # Strip attached job roles from names (e.g. 'Anurag Verma Software Engineer' -> 'Anurag Verma')
    for role in PERSON_ROLE_PATTERNS:
        pat = rf'\s+(?:-\s+|\|\s+|at\s+|,\s+)?{role}.*$'
        if re.search(pat, cleaned, flags=re.IGNORECASE):
            cand = re.sub(pat, '', cleaned, flags=re.IGNORECASE).strip()
            # Keep if the base name still has substantial length and isn't just an adjective
            if len(cand) >= 3 and cand.lower() not in {"software", "full-stack", "full stack", "backend", "frontend", "ai", "data"}:
                cleaned = cand
                break

    return cleaned

def normalize_entity_type(raw_type: str, name: str) -> str:
    """Strictly maps raw entity types to canonical ontology, enforcing Person overrides."""
    t = (raw_type or "").strip()
    # Direct match in valid set
    for vt in VALID_ENTITY_TYPES:
        if vt.lower() == t.lower():
            return vt
            
    # Substring match in normalization map
    lower_t = t.lower()
    for k, v in TYPE_NORMALIZATION_MAP.items():
        if k in lower_t:
            return v
            
    # Check common technology keywords in name
    lower_n = name.lower()
    if any(kw in lower_n for kw in ["python", "docker", "fastapi", "react", "next.js", "postgres", "sql", "jwt", "git", "api", "qdrant", "redis", "linux", "html", "css", "typescript", "javascript"]):
        return "Technology"

    return "Concept"

def extract_entities_and_relations(
    text: str,
    filename: str,
    page: int = 1,
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
    models_to_try = ["qwen/qwen3.8-27b", "openai/gpt-oss-120b", "qwen/qwen3.6-27b", "openai/gpt-oss-20b"]
    
    for model in models_to_try:
        try:
            llm = ChatGroq(model=model, temperature=0.0, max_tokens=1800)
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
        except Exception as exc:
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

    for ent in entities:
        if not isinstance(ent, dict):
            continue
        raw_name = ent.get("name", "")
        if not raw_name:
            continue
            
        cname = canonicalize_name(raw_name)
        if not cname or len(cname) < 2 or cname.lower() in seen_entity_names:
            continue
            
        # Filter out generic stop labels
        if cname.lower() in {"subject", "unknown", "document", "item", "page"}:
            continue
            
        seen_entity_names.add(cname.lower())
        raw_type = ent.get("type", "Concept")
        norm_type = normalize_entity_type(raw_type, cname)

        cleaned_entities.append({
            "name": cname,
            "type": norm_type,
            "description": ent.get("description", "").strip(),
            "aliases": [canonicalize_name(a) for a in ent.get("aliases", []) if a and canonicalize_name(a)],
        })

    valid_entity_names_lower = {e["name"].lower() for e in cleaned_entities}
    cleaned_relations = []
    seen_rel_keys = set()

    for rel in relations:
        if not isinstance(rel, dict):
            continue
        src = canonicalize_name(rel.get("source", ""))
        tgt = canonicalize_name(rel.get("target", ""))
        
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
    )

    return {"entities": cleaned_entities, "relations": cleaned_relations}

