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

    prompt = EXTRACTION_PROMPT.format(filename=filename, page=page, text=text[:2500])
    
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
        return {"entities": [], "relations": []}

    entities = extracted_json.get("entities", [])
    relations = extracted_json.get("relations", [])

    # Disambiguation & Database Ingestion
    name_to_id: dict[str, str] = {}

    for ent in entities:
        if not isinstance(ent, dict):
            continue
        raw_name = ent.get("name", "")
        if not raw_name:
            continue
        cname = canonicalize_name(raw_name)
        etype = ent.get("type", "Concept")
        desc = ent.get("description", "")
        aliases = [canonicalize_name(a) for a in ent.get("aliases", []) if a]
        
        ent_id = upsert_entity(
            canonical_name=cname,
            entity_type=etype,
            description=desc,
            aliases=aliases,
            source_doc=filename,
        )
        if ent_id:
            name_to_id[cname.lower()] = ent_id
            for alias in aliases:
                name_to_id[alias.lower()] = ent_id

    for rel in relations:
        if not isinstance(rel, dict):
            continue
        src_name = canonicalize_name(rel.get("source", "")).lower()
        tgt_name = canonicalize_name(rel.get("target", "")).lower()
        rel_type = rel.get("type", "RELATES_TO")
        rel_desc = rel.get("description", "")
        rel_weight = float(rel.get("weight", 1.0))

        src_id = name_to_id.get(src_name)
        tgt_id = name_to_id.get(tgt_name)

        if src_id and tgt_id and src_id != tgt_id:
            add_relation(
                source_entity_id=src_id,
                target_entity_id=tgt_id,
                relation_type=rel_type,
                weight=rel_weight,
                description=rel_desc,
                source_doc=filename,
                page_num=page,
                snippet=text[:300].strip(),
            )

    return {"entities": entities, "relations": relations}
