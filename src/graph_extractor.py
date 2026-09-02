"""Entity-Relation Property Graph (ERPG) Extraction and Semantic Deduplication Engine."""
import json
import re
from typing import Any
from langchain_groq import ChatGroq
from src.graph_db import upsert_entity, add_relation

EXTRACTION_PROMPT = """You are an expert Knowledge Graph & Ontology Extractor.
Extract the key real-world entities and meaningful directed relationships from the following text chunk.

Entity Types allowed: 'Concept', 'System', 'Technology', 'Organization', 'Person', 'Document', 'Process', 'Component'
Relationship Types should be uppercase verbs/phrases like: 'USES', 'DEPENDS_ON', 'INTEGRATES_WITH', 'IMPLEMENTS', 'RESOLVES', 'CONTAINS', 'AUTHORS', 'CONFIGURES'.

Return ONLY valid JSON matching this exact structure:
{
  "entities": [
    {
      "name": "Canonical Entity Name",
      "type": "Technology",
      "description": "Short 1-sentence description",
      "aliases": ["Alias 1", "Acronym"]
    }
  ],
  "relations": [
    {
      "source": "Source Entity Name",
      "target": "Target Entity Name",
      "type": "USES",
      "description": "Short explanation of relation",
      "weight": 1.0
    }
  ]
}

Text Chunk (from document '{filename}', page {page}):
\"\"\"
{text}
\"\"\"

Output JSON:"""

def canonicalize_name(name: str) -> str:
    """Normalizes entity names for semantic deduplication."""
    cleaned = name.strip().strip("\"'`")
    # Collapse multiple whitespaces
    cleaned = re.sub(r'\s+', ' ', cleaned)
    # Remove trailing punctuation
    cleaned = re.sub(r'[\.,;:]+$', '', cleaned).strip()
    return cleaned

def extract_entities_and_relations(
    text: str,
    filename: str,
    page: int = 1,
) -> dict[str, Any]:
    """Extracts ERPG entities and relations from a text chunk using LLM with fallback heuristics."""
    if not text or len(text.strip()) < 40:
        return {"entities": [], "relations": []}

    prompt = (
        EXTRACTION_PROMPT
        .replace("{filename}", str(filename))
        .replace("{page}", str(page))
        .replace("{text}", str(text[:2500]))
    )
    
    extracted_json = None
    for model in ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"]:
        try:
            llm = ChatGroq(model=model, temperature=0.0, max_tokens=1500)
            res = llm.invoke(prompt)
            raw = res.content
            raw = re.sub(r'<think>[\s\S]*?</think>', '', raw).strip()
            # Extract JSON block
            json_match = re.search(r'\{[\s\S]*\}', raw)
            if json_match:
                extracted_json = json.loads(json_match.group(0))
                break
        except Exception as exc:
            continue

    if not extracted_json or not isinstance(extracted_json, dict):
        extracted_json = {"entities": [], "relations": []}

    entities = extracted_json.get("entities", [])
    relations = extracted_json.get("relations", [])

    # Heuristic Rule-Based Fallback if LLM extraction returned 0 entities
    if not entities:
        candidates = list(dict.fromkeys(re.findall(r'\b[A-Z][A-Za-z0-9_-]{2,}(?:\s+[A-Z][A-Za-z0-9_-]{2,})*\b', text)))
        stopwords = {"This", "That", "There", "Here", "With", "From", "Your", "Please", "Document", "Section", "Table", "Figure", "After", "Before", "When", "Where", "Which", "About", "Total", "Amount", "Invoice", "Number", "Date", "Page"}
        filtered = [c for c in candidates if c not in stopwords and len(c) > 2][:12]
        
        for name in filtered:
            entities.append({
                "name": name,
                "type": "Technology" if any(term in name.lower() for term in ["db", "key", "token", "auth", "api", "pdf", "sql", "rag", "qdrant", "zone", "headphone"]) else "Concept",
                "description": f"Extracted from {filename} (page {page})",
                "aliases": []
            })
            
        for i in range(len(entities) - 1):
            relations.append({
                "source": entities[i]["name"],
                "target": entities[i+1]["name"],
                "type": "ASSOCIATED_WITH",
                "description": f"Co-occurs in {filename}",
                "weight": 1.0
            })

    # Disambiguation & Batched Database Ingestion (Atomic Single-Transaction)
    cleaned_entities = []
    for ent in entities:
        if not isinstance(ent, dict):
            continue
        raw_name = ent.get("name", "")
        if not raw_name:
            continue
        cleaned_entities.append({
            "name": canonicalize_name(raw_name),
            "type": ent.get("type", "Concept"),
            "description": ent.get("description", ""),
            "aliases": [canonicalize_name(a) for a in ent.get("aliases", []) if a],
        })

    cleaned_relations = []
    for rel in relations:
        if not isinstance(rel, dict):
            continue
        cleaned_relations.append({
            "source": canonicalize_name(rel.get("source", "")),
            "target": canonicalize_name(rel.get("target", "")),
            "type": rel.get("type", "RELATES_TO"),
            "description": rel.get("description", ""),
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
