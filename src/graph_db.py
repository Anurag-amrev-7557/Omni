"""SQLite-backed persistence for Entity-Relation Knowledge Graph, Hierarchical Communities, and Provenance."""
import os
import re
import json
import uuid
import sqlite3
from typing import Any
from collections import defaultdict
from src.config import ROOT_DIR

DB_PATH = os.path.join(ROOT_DIR, "data", "knowledge_graph.db")

try:
    from src.auth import get_current_user, DEFAULT_LOCAL_USER
except ImportError:
    try:
        from auth import get_current_user, DEFAULT_LOCAL_USER
    except ImportError:
        DEFAULT_LOCAL_USER = "10d2f529-3fae-4a29-9a5e-312876700ff9"
        def get_current_user() -> str:
            return DEFAULT_LOCAL_USER

def get_db_connection() -> sqlite3.Connection:
    """Opens a SQLite connection with row factories and foreign key support."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.row_factory = sqlite3.Row
    return conn

def init_graph_db():
    """Initializes graph tables and performance indices in SQLite."""
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # 1. Graph Entities
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
            )
        """)

        # 2. Graph Relations
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
            )
        """)

        # 3. Hierarchical Communities
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
            )
        """)

        # Indices for ultra-fast multi-hop traversals
        cur.execute("CREATE INDEX IF NOT EXISTS idx_graph_entities_user ON graph_entities(user_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_graph_entities_comm ON graph_entities(user_id, community_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_graph_rel_source ON graph_relations(user_id, source_entity_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_graph_rel_target ON graph_relations(user_id, target_entity_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_graph_rel_doc ON graph_relations(user_id, source_doc)")

        conn.commit()
        conn.close()
    except Exception as exc:
        print(f"[GraphDB] Error initializing graph tables: {exc}")

def upsert_entity(
    canonical_name: str,
    entity_type: str = "Concept",
    description: str = "",
    aliases: list[str] | None = None,
    source_doc: str | None = None,
    user_id: str | None = None,
) -> str:
    """Inserts or merges an entity into graph_entities with array deduplication."""
    uid = user_id or get_current_user()
    cname = canonical_name.strip()
    new_aliases = [a.strip() for a in (aliases or []) if a and a.strip()]
    new_docs = [source_doc.strip()] if source_doc and source_doc.strip() else []

    conn = get_db_connection()
    cur = conn.cursor()

    cur.execute(
        "SELECT entity_id, entity_type, description, aliases, source_docs FROM graph_entities WHERE user_id=? AND canonical_name=?",
        (uid, cname)
    )
    row = cur.fetchone()

    if row:
        ent_id = row["entity_id"]
        existing_type = row["entity_type"]
        existing_desc = row["description"] or ""
        try:
            curr_aliases = set(json.loads(row["aliases"] or "[]"))
        except Exception:
            curr_aliases = set()
        try:
            curr_docs = set(json.loads(row["source_docs"] or "[]"))
        except Exception:
            curr_docs = set()

        curr_aliases.update(new_aliases)
        curr_docs.update(new_docs)

        # Prioritize higher-information types
        final_type = existing_type
        if entity_type in ("Person", "Organization", "Technology", "System") and existing_type == "Concept":
            final_type = entity_type
        final_desc = description if len(description) > len(existing_desc) else existing_desc

        cur.execute("""
            UPDATE graph_entities
            SET entity_type = ?, description = ?, aliases = ?, source_docs = ?, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND entity_id = ?
        """, (final_type, final_desc, json.dumps(sorted(list(curr_aliases))), json.dumps(sorted(list(curr_docs))), uid, ent_id))
    else:
        ent_id = str(uuid.uuid4())
        cur.execute("""
            INSERT INTO graph_entities (entity_id, user_id, canonical_name, entity_type, description, aliases, source_docs)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (ent_id, uid, cname, entity_type, description, json.dumps(sorted(list(set(new_aliases)))), json.dumps(sorted(list(set(new_docs))))))

    conn.commit()
    conn.close()
    return ent_id

def add_relation(
    source_entity_id: str,
    target_entity_id: str,
    relation_type: str,
    weight: float = 1.0,
    description: str = "",
    source_doc: str = "",
    page_num: int = 1,
    snippet: str = "",
    user_id: str | None = None,
) -> str:
    """Adds or merges a directed edge between two entities, eliminating duplicates."""
    uid = user_id or get_current_user()
    norm_type = relation_type.upper().strip()
    rel_id = str(uuid.uuid4())

    conn = get_db_connection()
    cur = conn.cursor()

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
        rel_id, uid, source_entity_id, target_entity_id,
        norm_type, weight, description.strip(),
        source_doc.strip(), page_num, snippet.strip()
    ))

    cur.execute(
        "SELECT relation_id FROM graph_relations WHERE user_id=? AND source_entity_id=? AND target_entity_id=? AND relation_type=?",
        (uid, source_entity_id, target_entity_id, norm_type)
    )
    r_row = cur.fetchone()
    res_id = r_row["relation_id"] if r_row else rel_id

    conn.commit()
    conn.close()
    return res_id

def batch_save_entities_and_relations(
    entities: list[dict],
    relations: list[dict],
    filename: str,
    page: int = 1,
    snippet: str = "",
    user_id: str | None = None,
) -> tuple[dict[str, str], int]:
    """Atomically upserts a batch of entities and relations using a single connection and transaction."""
    uid = user_id or get_current_user()
    name_to_id: dict[str, str] = {}
    relations_saved = 0

    conn = get_db_connection()
    cur = conn.cursor()

    try:
        # 1. Upsert all entities
        for ent in entities:
            cname = ent.get("name", "").strip()
            if not cname:
                continue
            etype = ent.get("type", "Concept").strip()
            desc = ent.get("description", "").strip()
            aliases = [a.strip() for a in ent.get("aliases", []) if a and a.strip()]
            new_doc = filename.strip() if filename else ""

            cur.execute(
                "SELECT entity_id, entity_type, description, aliases, source_docs FROM graph_entities WHERE user_id=? AND canonical_name=?",
                (uid, cname)
            )
            row = cur.fetchone()

            if row:
                ent_id = row["entity_id"]
                existing_type = row["entity_type"]
                existing_desc = row["description"] or ""
                try:
                    curr_aliases = set(json.loads(row["aliases"] or "[]"))
                except Exception:
                    curr_aliases = set()
                try:
                    curr_docs = set(json.loads(row["source_docs"] or "[]"))
                except Exception:
                    curr_docs = set()

                curr_aliases.update(aliases)
                if new_doc:
                    curr_docs.add(new_doc)

                final_type = existing_type
                if etype in ("Person", "Organization", "Technology", "System") and existing_type == "Concept":
                    final_type = etype
                final_desc = desc if len(desc) > len(existing_desc) else existing_desc

                cur.execute("""
                    UPDATE graph_entities
                    SET entity_type = ?, description = ?, aliases = ?, source_docs = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = ? AND entity_id = ?
                """, (final_type, final_desc, json.dumps(sorted(list(curr_aliases))), json.dumps(sorted(list(curr_docs))), uid, ent_id))
            else:
                ent_id = str(uuid.uuid4())
                init_docs = [new_doc] if new_doc else []
                cur.execute("""
                    INSERT INTO graph_entities (entity_id, user_id, canonical_name, entity_type, description, aliases, source_docs)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (ent_id, uid, cname, etype, desc, json.dumps(sorted(list(set(aliases)))), json.dumps(init_docs)))

            name_to_id[cname.lower()] = ent_id
            for a in aliases:
                name_to_id[a.lower()] = ent_id

        # 2. Upsert all relations
        for rel in relations:
            src_name = rel.get("source", "").strip().lower()
            tgt_name = rel.get("target", "").strip().lower()
            src_id = name_to_id.get(src_name)
            tgt_id = name_to_id.get(tgt_name)

            if src_id and tgt_id and src_id != tgt_id:
                rel_id = str(uuid.uuid4())
                norm_type = rel.get("type", "RELATES_TO").upper().strip()
                rel_weight = float(rel.get("weight", 1.0))
                rel_desc = rel.get("description", "").strip()

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
                    rel_id, uid, src_id, tgt_id,
                    norm_type, rel_weight, rel_desc,
                    filename.strip(), page, snippet[:300].strip()
                ))
                relations_saved += 1

        conn.commit()
    finally:
        conn.close()

    try:
        run_entity_resolution_and_deduplication(uid)
    except Exception as er_exc:
        print(f"[GraphDB] Entity resolution notice: {er_exc}")

    return name_to_id, relations_saved

def get_user_graph(user_id: str | None = None, active_filenames: list[str] | None = None) -> dict:
    """Returns the full knowledge graph (nodes, edges, communities, metrics) for current user."""
    uid = user_id or get_current_user()

    conn = get_db_connection()
    cur = conn.cursor()
    if uid in (DEFAULT_LOCAL_USER, "default_user", "00000000-0000-0000-0000-000000000000"):
        user_clause = "user_id IN (?, 'default_user', '10d2f529-3fae-4a29-9a5e-312876700ff9')"
    else:
        user_clause = "user_id = ?"

    # Fetch entities
    cur.execute(f"""
        SELECT entity_id as id, canonical_name as name, entity_type as type,
               description, aliases, community_id, degree, pagerank, source_docs
        FROM graph_entities WHERE {user_clause} ORDER BY degree DESC
    """, (uid,))
    raw_nodes = cur.fetchall()

    nodes = []
    for r in raw_nodes:
        d = dict(r)
        try:
            d["aliases"] = json.loads(d["aliases"] or "[]")
        except Exception:
            d["aliases"] = []
        try:
            d["source_docs"] = json.loads(d["source_docs"] or "[]")
        except Exception:
            d["source_docs"] = []
        nodes.append(d)

    # Fetch relations
    cur.execute(f"""
        SELECT relation_id as id, source_entity_id as source,
               target_entity_id as target, relation_type as type,
               weight, description, source_doc, page_num, snippet
        FROM graph_relations WHERE {user_clause}
    """, (uid,))
    raw_links = [dict(r) for r in cur.fetchall()]

    # Deduplicate links (merge multiple relations into single edge)
    links = []
    seen_link_keys = set()
    for l in raw_links:
        s, t, rel_t = str(l["source"]), str(l["target"]), str(l.get("type", "")).upper()
        link_key = (min(s, t), max(s, t), rel_t)
        if link_key not in seen_link_keys:
            seen_link_keys.add(link_key)
            links.append(l)

    if active_filenames is not None:
        active_set = set(active_filenames)
        links = [l for l in links if l.get("source_doc") in active_set]
        active_node_ids = {l["source"] for l in links} | {l["target"] for l in links}
        nodes = [n for n in nodes if n["id"] in active_node_ids or any(doc in active_set for doc in n.get("source_docs", []))]

    # Fetch communities
    cur.execute(f"""
        SELECT community_id as id, level, title, summary, key_entities, findings
        FROM graph_communities WHERE {user_clause} ORDER BY level, community_id
    """, (uid,))
    raw_communities = cur.fetchall()

    communities = []
    for r in raw_communities:
        cd = dict(r)
        try:
            cd["key_entities"] = json.loads(cd["key_entities"] or "[]")
        except Exception:
            cd["key_entities"] = []
        try:
            cd["findings"] = json.loads(cd["findings"] or "[]")
        except Exception:
            cd["findings"] = []
        communities.append(cd)

    conn.close()

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

def save_community_clusters(clusters: list[dict], user_id: str | None = None):
    """Saves hierarchical community clusters and summaries."""
    uid = user_id or get_current_user()
    conn = get_db_connection()
    cur = conn.cursor()

    cur.execute("DELETE FROM graph_communities WHERE user_id=?", (uid,))
    for c in clusters:
        cur.execute("""
            INSERT INTO graph_communities (
                community_id, user_id, level, title, summary, key_entities, findings
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (user_id, level, community_id) DO UPDATE SET
                title = excluded.title,
                summary = excluded.summary,
                key_entities = excluded.key_entities,
                findings = excluded.findings
        """, (
            c.get("community_id", 0),
            uid,
            c.get("level", 0),
            c.get("title", f"Community {c.get('community_id', 0)}"),
            c.get("summary", ""),
            json.dumps(c.get("key_entities", [])),
            json.dumps(c.get("findings", [])),
        ))

    conn.commit()
    conn.close()

def update_entity_metrics(entity_updates: list[dict], user_id: str | None = None):
    """Batch updates degree, PageRank, and community assignments."""
    uid = user_id or get_current_user()
    conn = get_db_connection()
    cur = conn.cursor()

    for u in entity_updates:
        cur.execute("""
            UPDATE graph_entities SET
                community_id = ?,
                degree = ?,
                pagerank = ?
            WHERE entity_id = ? AND user_id = ?
        """, (
            u.get("community_id", 0),
            u.get("degree", 0),
            u.get("pagerank", 1.0),
            u["entity_id"],
            uid
        ))

    conn.commit()
    conn.close()

def sync_and_prune_graph(user_id: str | None = None, active_filenames: list[str] | None = None):
    """Prunes entities, relations, and communities that do not belong to active vault documents."""
    uid = user_id or get_current_user()
    if active_filenames is None:
        return
    active_set = set(f.strip() for f in active_filenames if f and f.strip())

    conn = get_db_connection()
    cur = conn.cursor()

    if not active_set:
        cur.execute("DELETE FROM graph_relations WHERE (user_id = ? OR user_id = 'default_user' OR user_id = '10d2f529-3fae-4a29-9a5e-312876700ff9')", (uid,))
        cur.execute("DELETE FROM graph_entities WHERE (user_id = ? OR user_id = 'default_user' OR user_id = '10d2f529-3fae-4a29-9a5e-312876700ff9')", (uid,))
        cur.execute("DELETE FROM graph_communities WHERE (user_id = ? OR user_id = 'default_user' OR user_id = '10d2f529-3fae-4a29-9a5e-312876700ff9')", (uid,))
        conn.commit()
        conn.close()
        return

    # 1. Delete relations originating from documents no longer in active_set
    placeholders = ",".join("?" for _ in active_set)
    cur.execute(f"""
        DELETE FROM graph_relations
        WHERE (user_id = ? OR user_id = 'default_user' OR user_id = '10d2f529-3fae-4a29-9a5e-312876700ff9')
        AND source_doc != '' AND source_doc NOT IN ({placeholders})
    """, [uid] + list(active_set))

    # 2. Update source_docs arrays on entities
    cur.execute("SELECT entity_id, source_docs FROM graph_entities WHERE user_id = ? OR user_id = 'default_user' OR user_id = '10d2f529-3fae-4a29-9a5e-312876700ff9'", (uid,))
    rows = cur.fetchall()
    for r in rows:
        try:
            docs = json.loads(r["source_docs"] or "[]")
        except Exception:
            docs = []
        filtered = [d for d in docs if d in active_set]
        if len(filtered) != len(docs):
            cur.execute("UPDATE graph_entities SET source_docs = ? WHERE entity_id = ?", (json.dumps(filtered), r["entity_id"]))

    # 3. Delete orphan entities with no active source_docs and no remaining relations
    cur.execute("""
        DELETE FROM graph_entities
        WHERE (user_id = ? OR user_id = 'default_user' OR user_id = '10d2f529-3fae-4a29-9a5e-312876700ff9')
        AND (source_docs = '[]' OR source_docs IS NULL OR source_docs = '')
        AND entity_id NOT IN (SELECT source_entity_id FROM graph_relations)
        AND entity_id NOT IN (SELECT target_entity_id FROM graph_relations)
    """, (uid,))

    # 4. Check remaining count
    cur.execute("SELECT COUNT(*) as count FROM graph_entities WHERE user_id = ? OR user_id = 'default_user' OR user_id = '10d2f529-3fae-4a29-9a5e-312876700ff9'", (uid,))
    cnt = cur.fetchone()["count"]
    if cnt == 0:
        cur.execute("DELETE FROM graph_communities WHERE user_id = ? OR user_id = 'default_user' OR user_id = '10d2f529-3fae-4a29-9a5e-312876700ff9'", (uid,))

    conn.commit()
    conn.close()

    run_entity_resolution_and_deduplication(uid)

def run_entity_resolution_and_deduplication(user_id: str | None = None) -> int:
    """Discovers and merges duplicate entities across documents based on stems, aliases, and prefixes."""
    uid = user_id or get_current_user()

    def normalize_entity_stem(name: str, etype: str = "") -> str:
        s = name.lower().strip()
        s = re.sub(r'^(?:dr|prof|mr|mrs|ms|hon|sir|dame|rev)\.?\s+', '', s)
        s = re.sub(r',?\s+(?:ph\.?d\.?|m\.?d\.?|b\.?e\.?|b\.?tech|m\.?tech|mba|esq\.?)$', '', s)
        if etype in ('Organization', 'Company'):
            s = re.sub(r'\b(?:inc|incorporated|llc|ltd|limited|corp|corporation|pvt|private|technologies|solutions|co)\b\.?', '', s)
        if etype in ('Technology', 'System', 'Skill'):
            s = re.sub(r'\.js$', '', s)
            s = re.sub(r'\b(?:framework|library|database|db|platform|engine|sdk|api)\b', '', s)
        s = re.sub(r'\s*[-–—|:/]\s*.*$', '', s)
        s = re.sub(r'\s*\([^)]*\)', '', s)
        return re.sub(r'[^a-z0-9]', '', s)

    conn = get_db_connection()
    cur = conn.cursor()

    cur.execute("""
        SELECT entity_id, canonical_name, entity_type, description, aliases, source_docs
        FROM graph_entities
        WHERE user_id = ?
    """, (uid,))
    raw_ents = cur.fetchall()

    stem_groups = defaultdict(list)
    for r in raw_ents:
        ent = dict(r)
        try:
            ent["aliases"] = json.loads(ent["aliases"] or "[]")
        except Exception:
            ent["aliases"] = []
        try:
            ent["source_docs"] = json.loads(ent["source_docs"] or "[]")
        except Exception:
            ent["source_docs"] = []
        stem = normalize_entity_stem(ent['canonical_name'], ent.get('entity_type', ''))
        if len(stem) >= 3:
            stem_groups[stem].append(ent)

    merged_count = 0
    for stem, group in stem_groups.items():
        if len(group) <= 1:
            continue

        def score_entity(e):
            type_score = 0
            et = e.get('entity_type', 'Concept')
            if et == 'Person': type_score = 50
            elif et == 'Organization': type_score = 40
            elif et == 'Technology': type_score = 30
            elif et == 'System': type_score = 25
            elif et in ('Role', 'Skill', 'Award'): type_score = 20
            elif et != 'Concept': type_score = 15
            name_len_score = max(0, 50 - len(e['canonical_name']))
            return type_score + name_len_score

        sorted_group = sorted(group, key=score_entity, reverse=True)
        primary = sorted_group[0]
        secondaries = sorted_group[1:]

        primary_id = primary['entity_id']
        all_source_docs = set(primary.get('source_docs') or [])
        all_aliases = set(primary.get('aliases') or [])
        best_desc = primary.get('description') or ''

        for sec in secondaries:
            sec_id = sec['entity_id']
            all_source_docs.update(sec.get('source_docs') or [])
            all_aliases.update(sec.get('aliases') or [])
            all_aliases.add(sec['canonical_name'])
            if len(sec.get('description') or '') > len(best_desc):
                best_desc = sec['description']

            # Redirect relations where secondary was source
            cur.execute("""
                UPDATE OR IGNORE graph_relations
                SET source_entity_id = ?
                WHERE user_id = ? AND source_entity_id = ?
            """, (primary_id, uid, sec_id))

            # Redirect relations where secondary was target
            cur.execute("""
                UPDATE OR IGNORE graph_relations
                SET target_entity_id = ?
                WHERE user_id = ? AND target_entity_id = ?
            """, (primary_id, uid, sec_id))

            # Delete redundant secondary entity
            cur.execute("DELETE FROM graph_entities WHERE user_id = ? AND entity_id = ?", (uid, sec_id))
            merged_count += 1

        # Clean self-referencing loops
        cur.execute("DELETE FROM graph_relations WHERE user_id = ? AND source_entity_id = target_entity_id", (uid,))

        # Update primary entity
        cur.execute("""
            UPDATE graph_entities
            SET source_docs = ?, aliases = ?, description = ?, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND entity_id = ?
        """, (json.dumps(sorted(list(all_source_docs))), json.dumps(sorted(list(all_aliases))), best_desc, uid, primary_id))

    conn.commit()
    conn.close()

    if merged_count > 0:
        print(f"[GraphDB] Resolved and unified {merged_count} fragmented entities for user {uid}")

    return merged_count

def delete_document_graph(filename: str, user_id: str | None = None):
    """Deletes graph edges and disconnected nodes originating solely from a deleted document."""
    uid = user_id or get_current_user()
    filename_clean = filename.strip()

    conn = get_db_connection()
    cur = conn.cursor()

    # Delete relations for this document across current user and default fallback
    cur.execute("DELETE FROM graph_relations WHERE source_doc=? AND (user_id=? OR user_id='default_user' OR user_id='10d2f529-3fae-4a29-9a5e-312876700ff9' OR user_id='default')", (filename_clean, uid))

    # Update source_docs on entities
    cur.execute("SELECT entity_id, source_docs FROM graph_entities WHERE user_id=? OR user_id='default_user' OR user_id='10d2f529-3fae-4a29-9a5e-312876700ff9' OR user_id='default'", (uid,))
    rows = cur.fetchall()
    for r in rows:
        try:
            docs = json.loads(r["source_docs"] or "[]")
        except Exception:
            docs = []
        if filename_clean in docs:
            docs.remove(filename_clean)
            cur.execute("UPDATE graph_entities SET source_docs=? WHERE entity_id=?", (json.dumps(docs), r["entity_id"]))

    # Delete orphan entities with no relations
    cur.execute("""
        DELETE FROM graph_entities
        WHERE entity_id NOT IN (SELECT source_entity_id FROM graph_relations)
        AND entity_id NOT IN (SELECT target_entity_id FROM graph_relations)
    """)

    # Check remaining count
    cur.execute("SELECT COUNT(*) as count FROM graph_entities WHERE user_id=? OR user_id='default_user'", (uid,))
    cnt = cur.fetchone()["count"]
    if cnt == 0:
        cur.execute("DELETE FROM graph_communities WHERE user_id=? OR user_id='default_user'", (uid,))

    conn.commit()
    conn.close()

def clear_user_graph(user_id: str | None = None):
    """Deletes all knowledge graph data for the current user."""
    uid = user_id or get_current_user()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM graph_relations WHERE user_id=?", (uid,))
    cur.execute("DELETE FROM graph_entities WHERE user_id=?", (uid,))
    cur.execute("DELETE FROM graph_communities WHERE user_id=?", (uid,))
    conn.commit()
    conn.close()
    print(f"[GraphDB] Cleared all knowledge graph data for user {uid}")
