"""SQLite-backed persistence for Entity-Relation Knowledge Graph, Hierarchical Communities, and Provenance."""
from collections import defaultdict
from contextlib import contextmanager
import json
import os
import re
import sqlite3
from typing import Any, Optional
import uuid

from src.config.settings import settings
from src.core.auth import get_current_user
from src.core.logging import logger
from src.core.security import is_default_or_local_user, normalize_user_id

DEFAULT_LOCAL_USER = settings.DEFAULT_LOCAL_USER
DB_PATH = settings.GRAPH_DB_PATH
_db_dir_checked = False

_HONORIFICS_RE = re.compile(r'^(?:dr|prof|mr|mrs|ms|hon|sir|dame|rev)\.?\s+', re.IGNORECASE)
_DEGREES_RE = re.compile(r',?\s+(?:ph\.?d\.?|m\.?d\.?|b\.?e\.?|b\.?tech|m\.?tech|mba|esq\.?)$', re.IGNORECASE)
_CORP_SUFFIX_RE = re.compile(r'\b(?:inc|incorporated|llc|ltd|limited|corp|corporation|pvt|private|technologies|solutions|co)\b\.?', re.IGNORECASE)
_TECH_JS_RE = re.compile(r'\.js$', re.IGNORECASE)
_TECH_TERMS_RE = re.compile(r'\b(?:framework|library|database|db|platform|engine|sdk|api)\b', re.IGNORECASE)
_TRAILING_DASH_RE = re.compile(r'\s*[-–—|:/]\s*.*$')
_PARENTHETICAL_RE = re.compile(r'\s*\([^)]*\)')
_ALPHANUMERIC_ONLY_RE = re.compile(r'[^a-z0-9]')


def get_db_connection() -> sqlite3.Connection:
    """Opens a SQLite connection with row factories and foreign key support."""
    global _db_dir_checked
    if not _db_dir_checked:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        _db_dir_checked = True
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def _cursor(commit: bool = False):
    """Context manager yielding a SQLite cursor and handling transaction lifecycle."""
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        yield cur
        if commit:
            conn.commit()
    finally:
        conn.close()


def _parse_json(val: Any, default: Any = None) -> Any:
    """Safely parses JSON values with fallback for SQLite text fields."""
    if val is None:
        return [] if default is None else default
    if isinstance(val, (list, dict)):
        return val
    try:
        return json.loads(val)
    except Exception:
        return [] if default is None else default


def _user_clause(uid: str) -> tuple[str, tuple]:
    """Returns WHERE clause fragment and params scoped to user and local dev sentinels."""
    if is_default_or_local_user(uid):
        return "(user_id = ? OR user_id = ? OR user_id = ?)", (uid, DEFAULT_LOCAL_USER, "default_user")
    return "user_id = ?", (uid,)


def _prune_orphaned_entities_and_communities(cur: sqlite3.Cursor, clause: str, params: tuple):
    """Prunes entities disconnected from all documents/relations and cleans empty communities."""
    cur.execute(f"""
        DELETE FROM graph_entities
        WHERE ({clause})
        AND (source_docs = '[]' OR source_docs IS NULL OR source_docs = '')
        AND entity_id NOT IN (SELECT source_entity_id FROM graph_relations)
        AND entity_id NOT IN (SELECT target_entity_id FROM graph_relations)
    """, params)

    cur.execute(f"SELECT COUNT(*) as count FROM graph_entities WHERE {clause}", params)
    if cur.fetchone()["count"] == 0:
        cur.execute(f"DELETE FROM graph_communities WHERE {clause}", params)


def init_graph_db():
    """Initializes graph tables, WAL mode, and performance indices in SQLite."""
    global _db_dir_checked
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    _db_dir_checked = True
    try:
        with _cursor(commit=True) as cur:
            try:
                cur.execute("PRAGMA journal_mode = WAL;")
                cur.execute("PRAGMA synchronous = NORMAL;")
            except Exception:
                pass
            cur.execute("""
                CREATE TABLE IF NOT EXISTS graph_entities (
                    entity_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL DEFAULT 'default_user',
                    canonical_name TEXT NOT NULL,
                    entity_type TEXT NOT NULL DEFAULT 'Concept',
                    description TEXT DEFAULT '',
                    aliases TEXT DEFAULT '[]',
                    community_id INTEGER DEFAULT 0,
                    degree INTEGER DEFAULT 0,
                    pagerank REAL DEFAULT 1.0,
                    source_docs TEXT DEFAULT '[]',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE (user_id, canonical_name)
                );
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS graph_relations (
                    relation_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL DEFAULT 'default_user',
                    source_entity_id TEXT NOT NULL,
                    target_entity_id TEXT NOT NULL,
                    relation_type TEXT NOT NULL DEFAULT 'RELATES_TO',
                    weight REAL DEFAULT 1.0,
                    description TEXT DEFAULT '',
                    source_doc TEXT DEFAULT '',
                    page_num INTEGER DEFAULT 1,
                    snippet TEXT DEFAULT '',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (source_entity_id) REFERENCES graph_entities(entity_id) ON DELETE CASCADE,
                    FOREIGN KEY (target_entity_id) REFERENCES graph_entities(entity_id) ON DELETE CASCADE,
                    UNIQUE (user_id, source_entity_id, target_entity_id, relation_type)
                );
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS graph_communities (
                    community_id INTEGER NOT NULL,
                    user_id TEXT NOT NULL DEFAULT 'default_user',
                    level INTEGER NOT NULL DEFAULT 0,
                    title TEXT NOT NULL,
                    summary TEXT NOT NULL DEFAULT '',
                    key_entities TEXT DEFAULT '[]',
                    findings TEXT DEFAULT '[]',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (user_id, level, community_id)
                );
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_graph_entities_user ON graph_entities(user_id);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_graph_entities_comm ON graph_entities(user_id, community_id);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_graph_rel_source ON graph_relations(user_id, source_entity_id);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_graph_rel_target ON graph_relations(user_id, target_entity_id);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_graph_rel_doc ON graph_relations(user_id, source_doc);")
    except Exception as exc:
        logger.error(f"Error initializing graph tables: {exc}")


def _upsert_entity_cursor(
    cur: sqlite3.Cursor,
    uid: str,
    cname: str,
    etype: str = "Concept",
    desc: str = "",
    aliases: Optional[list[str]] = None,
    source_doc: Optional[str] = None,
) -> str:
    """Internal helper to upsert or merge an entity using an active cursor."""
    new_aliases = [a.strip() for a in (aliases or []) if a and a.strip()]
    new_docs = [source_doc.strip()] if source_doc and source_doc.strip() else []

    cur.execute(
        "SELECT entity_id, entity_type, description, aliases, source_docs FROM graph_entities WHERE user_id=? AND canonical_name=?",
        (uid, cname)
    )
    row = cur.fetchone()

    if row:
        ent_id = row["entity_id"]
        curr_aliases = set(_parse_json(row["aliases"]))
        curr_docs = set(_parse_json(row["source_docs"]))
        curr_aliases.update(new_aliases)
        curr_docs.update(new_docs)

        final_type = row["entity_type"]
        if etype in ("Person", "Organization", "Technology", "System") and final_type == "Concept":
            final_type = etype
        existing_desc = row["description"] or ""
        final_desc = desc if len(desc) > len(existing_desc) else existing_desc

        cur.execute("""
            UPDATE graph_entities
            SET entity_type = ?, description = ?, aliases = ?, source_docs = ?, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND entity_id = ?
        """, (final_type, final_desc, json.dumps(sorted(curr_aliases)), json.dumps(sorted(curr_docs)), uid, ent_id))
        return ent_id

    ent_id = str(uuid.uuid4())
    cur.execute("""
        INSERT INTO graph_entities (entity_id, user_id, canonical_name, entity_type, description, aliases, source_docs)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (ent_id, uid, cname, etype, desc, json.dumps(sorted(set(new_aliases))), json.dumps(sorted(set(new_docs)))))
    return ent_id


def upsert_entity(
    canonical_name: str,
    entity_type: str = "Concept",
    description: str = "",
    aliases: Optional[list[str]] = None,
    source_doc: Optional[str] = None,
    user_id: Optional[str] = None,
) -> str:
    """Inserts or merges an entity into graph_entities with array deduplication."""
    uid = normalize_user_id(user_id or get_current_user())
    with _cursor(commit=True) as cur:
        return _upsert_entity_cursor(cur, uid, canonical_name.strip(), entity_type, description, aliases, source_doc)


def add_relation(
    source_entity_id: str,
    target_entity_id: str,
    relation_type: str,
    weight: float = 1.0,
    description: str = "",
    source_doc: str = "",
    page_num: int = 1,
    snippet: str = "",
    user_id: Optional[str] = None,
) -> str:
    """Adds or merges a directed edge between two entities, eliminating duplicates."""
    uid = normalize_user_id(user_id or get_current_user())
    norm_type = relation_type.upper().strip()
    rel_id = str(uuid.uuid4())

    with _cursor(commit=True) as cur:
        cur.execute("""
            INSERT INTO graph_relations (
                relation_id, user_id, source_entity_id, target_entity_id,
                relation_type, weight, description, source_doc, page_num, snippet
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (user_id, source_entity_id, target_entity_id, relation_type) DO UPDATE SET
                weight = MAX(graph_relations.weight, excluded.weight),
                description = CASE WHEN LENGTH(excluded.description) > LENGTH(graph_relations.description) THEN excluded.description ELSE graph_relations.description END,
                source_doc = CASE WHEN excluded.source_doc != '' THEN excluded.source_doc ELSE graph_relations.source_doc END,
                page_num = excluded.page_num,
                snippet = CASE WHEN LENGTH(excluded.snippet) > LENGTH(graph_relations.snippet) THEN excluded.snippet ELSE graph_relations.snippet END
            RETURNING relation_id;
        """, (
            rel_id, uid, source_entity_id, target_entity_id,
            norm_type, weight, description.strip(),
            source_doc.strip(), page_num, snippet.strip()
        ))
        row = cur.fetchone()
        return row["relation_id"] if row else rel_id


def batch_save_entities_and_relations(
    entities: list[dict],
    relations: list[dict],
    filename: str,
    page: int = 1,
    snippet: str = "",
    user_id: Optional[str] = None,
) -> tuple[dict[str, str], int]:
    """Atomically upserts a batch of entities and relations using a single connection and transaction."""
    uid = normalize_user_id(user_id or get_current_user())
    name_to_id: dict[str, str] = {}
    relations_saved = 0

    with _cursor(commit=True) as cur:
        for ent in entities:
            cname = ent.get("name", "").strip()
            if not cname:
                continue
            aliases = [a.strip() for a in ent.get("aliases", []) if a and a.strip()]
            ent_id = _upsert_entity_cursor(
                cur, uid, cname,
                ent.get("type", "Concept").strip(),
                ent.get("description", "").strip(),
                aliases,
                filename.strip() if filename else None
            )
            name_to_id[cname.lower()] = ent_id
            for a in aliases:
                name_to_id[a.lower()] = ent_id

        for rel in relations:
            src_name = rel.get("source", "").strip().lower()
            tgt_name = rel.get("target", "").strip().lower()
            src_id = name_to_id.get(src_name)
            tgt_id = name_to_id.get(tgt_name)

            if src_id and tgt_id and src_id != tgt_id:
                cur.execute("""
                    INSERT INTO graph_relations (
                        relation_id, user_id, source_entity_id, target_entity_id,
                        relation_type, weight, description, source_doc, page_num, snippet
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (user_id, source_entity_id, target_entity_id, relation_type) DO UPDATE SET
                        weight = MAX(graph_relations.weight, excluded.weight),
                        description = CASE WHEN LENGTH(excluded.description) > LENGTH(graph_relations.description) THEN excluded.description ELSE graph_relations.description END,
                        source_doc = CASE WHEN excluded.source_doc != '' THEN excluded.source_doc ELSE graph_relations.source_doc END,
                        page_num = excluded.page_num,
                        snippet = CASE WHEN LENGTH(excluded.snippet) > LENGTH(graph_relations.snippet) THEN excluded.snippet ELSE graph_relations.snippet END
                """, (
                    str(uuid.uuid4()), uid, src_id, tgt_id,
                    rel.get("type", "RELATES_TO").upper().strip(),
                    float(rel.get("weight", 1.0)),
                    rel.get("description", "").strip(),
                    filename.strip(), page, snippet[:300].strip()
                ))
                relations_saved += 1

    try:
        run_entity_resolution_and_deduplication(uid)
    except Exception as er_exc:
        logger.warning(f"Entity resolution notice: {er_exc}")

    return name_to_id, relations_saved


def get_user_graph(user_id: Optional[str] = None, active_filenames: Optional[list[str]] = None) -> dict:
    """Returns the full knowledge graph (nodes, edges, communities, metrics) for current user."""
    uid = normalize_user_id(user_id or get_current_user())
    clause, params = _user_clause(uid)

    with _cursor() as cur:
        cur.execute(f"""
            SELECT entity_id as id, canonical_name as name, entity_type as type,
                   description, aliases, community_id, degree, pagerank, source_docs
            FROM graph_entities WHERE {clause} ORDER BY degree DESC
        """, params)
        nodes = []
        for r in cur.fetchall():
            d = dict(r)
            d["aliases"] = _parse_json(d.get("aliases"))
            d["source_docs"] = _parse_json(d.get("source_docs"))
            nodes.append(d)

        cur.execute(f"""
            SELECT relation_id as id, source_entity_id as source,
                   target_entity_id as target, relation_type as type,
                   weight, description, source_doc, page_num, snippet
            FROM graph_relations WHERE {clause}
        """, params)
        raw_links = [dict(r) for r in cur.fetchall()]

        links = []
        seen = set()
        for lnk in raw_links:
            s, t, rel_t = str(lnk["source"]), str(lnk["target"]), str(lnk.get("type", "")).upper()
            link_key = (min(s, t), max(s, t), rel_t)
            if link_key not in seen:
                seen.add(link_key)
                links.append(lnk)

        if active_filenames is not None:
            active_set = set(active_filenames)
            links = [lnk for lnk in links if lnk.get("source_doc") in active_set]
            active_node_ids = {lnk["source"] for lnk in links} | {lnk["target"] for lnk in links}
            nodes = [n for n in nodes if n["id"] in active_node_ids or any(doc in active_set for doc in n.get("source_docs", []))]

        cur.execute(f"""
            SELECT community_id as id, level, title, summary, key_entities, findings
            FROM graph_communities WHERE {clause} ORDER BY level, community_id
        """, params)
        communities = []
        for r in cur.fetchall():
            cd = dict(r)
            cd["key_entities"] = _parse_json(cd.get("key_entities"))
            cd["findings"] = _parse_json(cd.get("findings"))
            communities.append(cd)

    return {
        "nodes": nodes,
        "links": links,
        "communities": communities,
        "stats": {
            "total_nodes": len(nodes),
            "total_links": len(links),
            "total_communities": len(communities),
        }
    }


def save_community_clusters(clusters: list[dict], user_id: Optional[str] = None):
    """Saves hierarchical community clusters and summaries using batch insertion."""
    uid = normalize_user_id(user_id or get_current_user())
    with _cursor(commit=True) as cur:
        cur.execute("DELETE FROM graph_communities WHERE user_id=?", (uid,))
        if clusters:
            params = [
                (
                    c.get("community_id", 0),
                    uid,
                    c.get("level", 0),
                    c.get("title", f"Community {c.get('community_id', 0)}"),
                    c.get("summary", ""),
                    json.dumps(c.get("key_entities", [])),
                    json.dumps(c.get("findings", [])),
                )
                for c in clusters
            ]
            cur.executemany("""
                INSERT INTO graph_communities (
                    community_id, user_id, level, title, summary, key_entities, findings
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (user_id, level, community_id) DO UPDATE SET
                    title = excluded.title,
                    summary = excluded.summary,
                    key_entities = excluded.key_entities,
                    findings = excluded.findings
            """, params)


def update_entity_metrics(entity_updates: list[dict], user_id: Optional[str] = None):
    """Batch updates degree, PageRank, and community assignments using a single executemany call."""
    uid = normalize_user_id(user_id or get_current_user())
    if not entity_updates:
        return
    with _cursor(commit=True) as cur:
        params = [
            (u.get("community_id", 0), u.get("degree", 0), u.get("pagerank", 1.0), u["entity_id"], uid)
            for u in entity_updates
        ]
        cur.executemany("""
            UPDATE graph_entities SET
                community_id = ?, degree = ?, pagerank = ?
            WHERE entity_id = ? AND user_id = ?
        """, params)


def sync_and_prune_graph(user_id: Optional[str] = None, active_filenames: Optional[list[str]] = None):
    """Prunes entities, relations, and communities that do not belong to active vault documents."""
    if active_filenames is None:
        return
    uid = normalize_user_id(user_id or get_current_user())
    clause, params = _user_clause(uid)
    active_set = set(f.strip() for f in active_filenames if f and f.strip())

    with _cursor(commit=True) as cur:
        if not active_set:
            cur.execute(f"DELETE FROM graph_relations WHERE {clause}", params)
            cur.execute(f"DELETE FROM graph_entities WHERE {clause}", params)
            cur.execute(f"DELETE FROM graph_communities WHERE {clause}", params)
            return

        placeholders = ",".join("?" for _ in active_set)
        cur.execute(f"""
            DELETE FROM graph_relations
            WHERE ({clause}) AND source_doc != '' AND source_doc NOT IN ({placeholders})
        """, list(params) + list(active_set))

        cur.execute(f"SELECT entity_id, source_docs FROM graph_entities WHERE {clause}", params)
        for r in cur.fetchall():
            docs = _parse_json(r["source_docs"])
            filtered = [d for d in docs if d in active_set]
            if len(filtered) != len(docs):
                cur.execute("UPDATE graph_entities SET source_docs = ? WHERE entity_id = ?", (json.dumps(filtered), r["entity_id"]))

        _prune_orphaned_entities_and_communities(cur, clause, params)

    run_entity_resolution_and_deduplication(uid)


def run_entity_resolution_and_deduplication(user_id: Optional[str] = None) -> int:
    """Discovers and merges duplicate entities across documents based on stems, aliases, and prefixes."""
    uid = normalize_user_id(user_id or get_current_user())

    def normalize_entity_stem(name: str, etype: str = "") -> str:
        s = name.lower().strip()
        s = _HONORIFICS_RE.sub('', s)
        s = _DEGREES_RE.sub('', s)
        if etype in ('Organization', 'Company'):
            s = _CORP_SUFFIX_RE.sub('', s)
        if etype in ('Technology', 'System', 'Skill'):
            s = _TECH_JS_RE.sub('', s)
            s = _TECH_TERMS_RE.sub('', s)
        s = _TRAILING_DASH_RE.sub('', s)
        s = _PARENTHETICAL_RE.sub('', s)
        return _ALPHANUMERIC_ONLY_RE.sub('', s)

    merged_count = 0
    with _cursor(commit=True) as cur:
        cur.execute("""
            SELECT entity_id, canonical_name, entity_type, description, aliases, source_docs
            FROM graph_entities WHERE user_id = ?
        """, (uid,))

        stem_groups = defaultdict(list)
        for r in cur.fetchall():
            ent = dict(r)
            ent["aliases"] = _parse_json(ent.get("aliases"))
            ent["source_docs"] = _parse_json(ent.get("source_docs"))
            stem = normalize_entity_stem(ent['canonical_name'], ent.get('entity_type', ''))
            if len(stem) >= 3:
                stem_groups[stem].append(ent)

        for stem, group in stem_groups.items():
            if len(group) <= 1:
                continue

            def score_entity(e):
                et = e.get('entity_type', 'Concept')
                type_score = {"Person": 50, "Organization": 40, "Technology": 30, "System": 25}.get(et, 20 if et != "Concept" else 15)
                return type_score + max(0, 50 - len(e['canonical_name']))

            sorted_group = sorted(group, key=score_entity, reverse=True)
            primary = sorted_group[0]
            primary_id = primary['entity_id']
            all_docs = set(primary.get('source_docs') or [])
            all_aliases = set(primary.get('aliases') or [])
            best_desc = primary.get('description') or ''

            for sec in sorted_group[1:]:
                sec_id = sec['entity_id']
                all_docs.update(sec.get('source_docs') or [])
                all_aliases.update(sec.get('aliases') or [])
                all_aliases.add(sec['canonical_name'])
                if len(sec.get('description') or '') > len(best_desc):
                    best_desc = sec['description']

                cur.execute("""
                    UPDATE OR IGNORE graph_relations SET source_entity_id = ?
                    WHERE user_id = ? AND source_entity_id = ?
                """, (primary_id, uid, sec_id))
                cur.execute("""
                    UPDATE OR IGNORE graph_relations SET target_entity_id = ?
                    WHERE user_id = ? AND target_entity_id = ?
                """, (primary_id, uid, sec_id))
                cur.execute("DELETE FROM graph_entities WHERE user_id = ? AND entity_id = ?", (uid, sec_id))
                merged_count += 1

            cur.execute("DELETE FROM graph_relations WHERE user_id = ? AND source_entity_id = target_entity_id", (uid,))
            cur.execute("""
                UPDATE graph_entities
                SET source_docs = ?, aliases = ?, description = ?, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ? AND entity_id = ?
            """, (json.dumps(sorted(all_docs)), json.dumps(sorted(all_aliases)), best_desc, uid, primary_id))

    if merged_count > 0:
        logger.info(f"Resolved and unified {merged_count} fragmented entities for user {uid}")

    return merged_count


def delete_document_graph(filename: str, user_id: Optional[str] = None):
    """Deletes graph edges and disconnected nodes originating solely from a deleted document."""
    uid = normalize_user_id(user_id or get_current_user())
    clause, params = _user_clause(uid)
    filename_clean = filename.strip()

    with _cursor(commit=True) as cur:
        cur.execute(f"DELETE FROM graph_relations WHERE source_doc=? AND ({clause})", (filename_clean,) + params)

        # Fast path: only inspect entities that actually reference the deleted document
        search_pattern = f"%{filename_clean}%"
        cur.execute(
            f"SELECT entity_id, source_docs FROM graph_entities WHERE ({clause}) AND source_docs LIKE ?",
            params + (search_pattern,)
        )
        for r in cur.fetchall():
            docs = _parse_json(r["source_docs"])
            if filename_clean in docs:
                docs.remove(filename_clean)
                cur.execute("UPDATE graph_entities SET source_docs=? WHERE entity_id=?", (json.dumps(docs), r["entity_id"]))

        _prune_orphaned_entities_and_communities(cur, clause, params)


def clear_user_graph(user_id: Optional[str] = None):
    """Deletes all knowledge graph data for the current user."""
    uid = normalize_user_id(user_id or get_current_user())
    with _cursor(commit=True) as cur:
        cur.execute("DELETE FROM graph_relations WHERE user_id=?", (uid,))
        cur.execute("DELETE FROM graph_entities WHERE user_id=?", (uid,))
        cur.execute("DELETE FROM graph_communities WHERE user_id=?", (uid,))
    logger.info(f"Cleared all knowledge graph data for user {uid}")
