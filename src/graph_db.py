"""PostgreSQL persistence for Entity-Relation Knowledge Graph, Hierarchical Communities, and Provenance."""
import uuid
from psycopg.types.json import Jsonb
from src.auth import get_current_user
from src.state_db import connection

def init_graph_db():
    """Initializes graph tables in PostgreSQL."""
    try:
        with connection() as conn, conn.cursor() as cur:
            # 1. Graph Entities
            cur.execute("""
                CREATE TABLE IF NOT EXISTS graph_entities (
                    entity_id UUID PRIMARY KEY,
                    user_id UUID NOT NULL,
                    canonical_name TEXT NOT NULL,
                    entity_type TEXT NOT NULL DEFAULT 'Concept',
                    description TEXT DEFAULT '',
                    aliases TEXT[] DEFAULT '{}',
                    community_id INTEGER DEFAULT 0,
                    degree INTEGER DEFAULT 0,
                    pagerank DOUBLE PRECISION DEFAULT 1.0,
                    source_docs TEXT[] DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    CONSTRAINT uq_user_entity UNIQUE (user_id, canonical_name)
                )
            """)

            # 2. Graph Relations
            cur.execute("""
                CREATE TABLE IF NOT EXISTS graph_relations (
                    relation_id UUID PRIMARY KEY,
                    user_id UUID NOT NULL,
                    source_entity_id UUID NOT NULL REFERENCES graph_entities(entity_id) ON DELETE CASCADE,
                    target_entity_id UUID NOT NULL REFERENCES graph_entities(entity_id) ON DELETE CASCADE,
                    relation_type TEXT NOT NULL,
                    weight DOUBLE PRECISION DEFAULT 1.0,
                    description TEXT DEFAULT '',
                    source_doc TEXT NOT NULL,
                    page_num INTEGER DEFAULT 1,
                    snippet TEXT DEFAULT '',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
            """)

            # 3. Hierarchical Communities
            cur.execute("""
                CREATE TABLE IF NOT EXISTS graph_communities (
                    community_id INTEGER NOT NULL,
                    user_id UUID NOT NULL,
                    level INTEGER NOT NULL DEFAULT 0,
                    title TEXT NOT NULL,
                    summary TEXT NOT NULL DEFAULT '',
                    key_entities TEXT[] DEFAULT '{}',
                    findings TEXT[] DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    PRIMARY KEY (user_id, level, community_id)
                )
            """)

            # Indexes and constraints for fast traversals and link deduplication
            cur.execute("CREATE INDEX IF NOT EXISTS idx_graph_entities_user ON graph_entities(user_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_graph_entities_comm ON graph_entities(user_id, community_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_graph_rel_source ON graph_relations(user_id, source_entity_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_graph_rel_target ON graph_relations(user_id, target_entity_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_graph_rel_doc ON graph_relations(user_id, source_doc)")

            # Deduplicate any pre-existing duplicate relations
            cur.execute("""
                DELETE FROM graph_relations a USING graph_relations b
                WHERE a.ctid < b.ctid
                  AND a.user_id = b.user_id
                  AND a.source_entity_id = b.source_entity_id
                  AND a.target_entity_id = b.target_entity_id
                  AND a.relation_type = b.relation_type;
            """)
            try:
                cur.execute("""
                    CREATE UNIQUE INDEX IF NOT EXISTS uq_user_relation
                    ON graph_relations (user_id, source_entity_id, target_entity_id, relation_type)
                """)
            except Exception:
                pass
    except Exception as exc:
        print(f"[GraphDB] Error initializing graph tables: {exc}")

def upsert_entity(
    canonical_name: str,
    entity_type: str = "Concept",
    description: str = "",
    aliases: list[str] | None = None,
    source_doc: str | None = None,
) -> str:
    """Inserts or merges an entity into graph_entities with array deduplication."""
    user_id = get_current_user()
    aliases = [a.strip() for a in (aliases or []) if a and a.strip()]
    source_docs = [source_doc.strip()] if source_doc and source_doc.strip() else []
    
    with connection() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO graph_entities (
                entity_id, user_id, canonical_name, entity_type, description, aliases, source_docs, updated_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, now()
            )
            ON CONFLICT (user_id, canonical_name) DO UPDATE SET
                entity_type = CASE 
                    WHEN EXCLUDED.entity_type = 'Person' THEN 'Person'
                    WHEN graph_entities.entity_type = 'Person' THEN 'Person'
                    WHEN EXCLUDED.entity_type = 'Organization' THEN 'Organization'
                    WHEN graph_entities.entity_type = 'Organization' THEN 'Organization'
                    WHEN EXCLUDED.entity_type != 'Concept' THEN EXCLUDED.entity_type 
                    ELSE graph_entities.entity_type 
                END,
                description = CASE WHEN LENGTH(EXCLUDED.description) > LENGTH(graph_entities.description) THEN EXCLUDED.description ELSE graph_entities.description END,
                aliases = (
                    SELECT COALESCE(array_agg(DISTINCT elem), '{}'::text[])
                    FROM unnest(array_cat(graph_entities.aliases, EXCLUDED.aliases)) AS elem
                    WHERE elem IS NOT NULL AND elem != ''
                ),
                source_docs = (
                    SELECT COALESCE(array_agg(DISTINCT elem), '{}'::text[])
                    FROM unnest(array_cat(graph_entities.source_docs, EXCLUDED.source_docs)) AS elem
                    WHERE elem IS NOT NULL AND elem != ''
                ),
                updated_at = now()
            RETURNING entity_id::text
        """, (
            str(uuid.uuid4()),
            user_id,
            canonical_name.strip(),
            entity_type.strip(),
            description.strip(),
            aliases,
            source_docs,
        ))
        row = cur.fetchone()
        return row["entity_id"] if row else ""

def add_relation(
    source_entity_id: str,
    target_entity_id: str,
    relation_type: str,
    weight: float = 1.0,
    description: str = "",
    source_doc: str = "",
    page_num: int = 1,
    snippet: str = "",
) -> str:
    """Adds or merges a directed edge between two entities, eliminating duplicates."""
    user_id = get_current_user()
    rel_id = str(uuid.uuid4())
    norm_type = relation_type.upper().strip()
    with connection() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO graph_relations (
                relation_id, user_id, source_entity_id, target_entity_id,
                relation_type, weight, description, source_doc, page_num, snippet
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            )
            ON CONFLICT (user_id, source_entity_id, target_entity_id, relation_type) DO UPDATE SET
                weight = GREATEST(graph_relations.weight, EXCLUDED.weight),
                description = CASE WHEN LENGTH(EXCLUDED.description) > LENGTH(graph_relations.description) THEN EXCLUDED.description ELSE graph_relations.description END,
                source_doc = CASE WHEN EXCLUDED.source_doc != '' THEN EXCLUDED.source_doc ELSE graph_relations.source_doc END,
                page_num = EXCLUDED.page_num,
                snippet = CASE WHEN LENGTH(EXCLUDED.snippet) > LENGTH(graph_relations.snippet) THEN EXCLUDED.snippet ELSE graph_relations.snippet END
            RETURNING relation_id::text
        """, (
            rel_id, user_id, source_entity_id, target_entity_id,
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
) -> tuple[dict[str, str], int]:
    """Atomically upserts a batch of entities and relations using a single connection and transaction."""
    user_id = get_current_user()
    name_to_id: dict[str, str] = {}
    relations_saved = 0

    with connection() as conn, conn.cursor() as cur:
        # 1. Upsert all entities
        for ent in entities:
            cname = ent.get("name", "").strip()
            if not cname:
                continue
            etype = ent.get("type", "Concept").strip()
            desc = ent.get("description", "").strip()
            aliases = [a.strip() for a in ent.get("aliases", []) if a and a.strip()]
            source_docs = [filename.strip()] if filename and filename.strip() else []

            cur.execute("""
                INSERT INTO graph_entities (
                    entity_id, user_id, canonical_name, entity_type, description, aliases, source_docs, updated_at
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, now()
                )
                ON CONFLICT (user_id, canonical_name) DO UPDATE SET
                    entity_type = CASE 
                        WHEN EXCLUDED.entity_type = 'Person' THEN 'Person'
                        WHEN graph_entities.entity_type = 'Person' THEN 'Person'
                        WHEN EXCLUDED.entity_type = 'Organization' THEN 'Organization'
                        WHEN graph_entities.entity_type = 'Organization' THEN 'Organization'
                        WHEN EXCLUDED.entity_type != 'Concept' THEN EXCLUDED.entity_type 
                        ELSE graph_entities.entity_type 
                    END,
                    description = CASE WHEN LENGTH(EXCLUDED.description) > LENGTH(graph_entities.description) THEN EXCLUDED.description ELSE graph_entities.description END,
                    aliases = (
                        SELECT COALESCE(array_agg(DISTINCT elem), '{}'::text[])
                        FROM unnest(array_cat(graph_entities.aliases, EXCLUDED.aliases)) AS elem
                        WHERE elem IS NOT NULL AND elem != ''
                    ),
                    source_docs = (
                        SELECT COALESCE(array_agg(DISTINCT elem), '{}'::text[])
                        FROM unnest(array_cat(graph_entities.source_docs, EXCLUDED.source_docs)) AS elem
                        WHERE elem IS NOT NULL AND elem != ''
                    ),
                    updated_at = now()
                RETURNING entity_id::text
            """, (
                str(uuid.uuid4()), user_id, cname, etype, desc, aliases, source_docs
            ))
            row = cur.fetchone()
            if row:
                ent_id = row["entity_id"]
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
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                    )
                    ON CONFLICT (user_id, source_entity_id, target_entity_id, relation_type) DO UPDATE SET
                        weight = GREATEST(graph_relations.weight, EXCLUDED.weight),
                        description = CASE WHEN LENGTH(EXCLUDED.description) > LENGTH(graph_relations.description) THEN EXCLUDED.description ELSE graph_relations.description END,
                        source_doc = CASE WHEN EXCLUDED.source_doc != '' THEN EXCLUDED.source_doc ELSE graph_relations.source_doc END,
                        page_num = EXCLUDED.page_num,
                        snippet = CASE WHEN LENGTH(EXCLUDED.snippet) > LENGTH(graph_relations.snippet) THEN EXCLUDED.snippet ELSE graph_relations.snippet END
                """, (
                    rel_id, user_id, src_id, tgt_id,
                    norm_type, rel_weight, rel_desc,
                    filename.strip(), page, snippet[:300].strip()
                ))
                relations_saved += 1

    # Run entity resolution to merge any fragmented entity nodes created across documents
    try:
        run_entity_resolution_and_deduplication(user_id)
    except Exception as er_exc:
        print(f"[GraphDB] Entity resolution notice: {er_exc}")

    try:
        from src.cache import invalidate_user_cache
        invalidate_user_cache(user_id)
    except Exception:
        pass

    return name_to_id, relations_saved


def get_user_graph(active_filenames: list[str] | None = None) -> dict:
    """Returns the full knowledge graph (nodes, edges, communities, metrics) for current user.
    If active_filenames is passed, automatically prunes nodes/relations from stale documents.
    """
    user_id = get_current_user()

    # Fast-path in-memory cache lookup for sub-millisecond retrieval
    if active_filenames is None:
        try:
            from src.cache import get_cached_user_graph, set_cached_user_graph
            cached = get_cached_user_graph(user_id)
            if cached is not None:
                return cached
        except Exception:
            pass

    if active_filenames is not None:
        sync_and_prune_graph(user_id, active_filenames)

    with connection() as conn, conn.cursor() as cur:
        # Fetch entities
        cur.execute("""
            SELECT entity_id::text as id, canonical_name as name, entity_type as type,
                   description, aliases, community_id, degree, pagerank, source_docs
            FROM graph_entities WHERE user_id=%s ORDER BY degree DESC
        """, (user_id,))
        nodes = [dict(r) for r in cur.fetchall()]

        # Fetch relations
        cur.execute("""
            SELECT r.relation_id::text as id, r.source_entity_id::text as source,
                   r.target_entity_id::text as target, r.relation_type as type,
                   r.weight, r.description, r.source_doc, r.page_num, r.snippet
            FROM graph_relations r WHERE r.user_id=%s
        """, (user_id,))
        raw_links = [dict(r) for r in cur.fetchall()]

        # Deduplicate links (merge multiple duplicate relations into single clean edge)
        links = []
        seen_link_keys = set()
        for l in raw_links:
            # Normalize pair so bidirectional or duplicate entries are unified
            s, t, rel_t = str(l["source"]), str(l["target"]), str(l.get("type", "")).upper()
            link_key = (min(s, t), max(s, t), rel_t)
            if link_key not in seen_link_keys:
                seen_link_keys.add(link_key)
                links.append(l)

        # Fetch communities
        cur.execute("""
            SELECT community_id as id, level, title, summary, key_entities, findings
            FROM graph_communities WHERE user_id=%s ORDER BY level, community_id
        """, (user_id,))
        communities = [dict(r) for r in cur.fetchall()]

        # Deduplicate source_docs for safety in client consumption
        for n in nodes:
            if n.get("source_docs"):
                n["source_docs"] = list(dict.fromkeys(n["source_docs"]))

        result = {
            "nodes": nodes,
            "links": links,
            "communities": communities,
            "stats": {
                "total_nodes": len(nodes),
                "total_links": len(links),
                "total_communities": len(communities),
            }
        }

        # Populate cache
        try:
            from src.cache import set_cached_user_graph
            set_cached_user_graph(user_id, result)
        except Exception:
            pass

        return result

def save_community_clusters(clusters: list[dict]):
    """Saves hierarchical community clusters and summaries."""
    user_id = get_current_user()
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM graph_communities WHERE user_id=%s", (user_id,))
        for c in clusters:
            cur.execute("""
                INSERT INTO graph_communities (
                    community_id, user_id, level, title, summary, key_entities, findings
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (user_id, level, community_id) DO UPDATE SET
                    title = EXCLUDED.title,
                    summary = EXCLUDED.summary,
                    key_entities = EXCLUDED.key_entities,
                    findings = EXCLUDED.findings
            """, (
                c.get("community_id", 0),
                user_id,
                c.get("level", 0),
                c.get("title", f"Community {c.get('community_id', 0)}"),
                c.get("summary", ""),
                c.get("key_entities", []),
                c.get("findings", []),
            ))

def update_entity_metrics(entity_updates: list[dict]):
    """Batch updates degree, PageRank, and community assignments."""
    user_id = get_current_user()
    with connection() as conn, conn.cursor() as cur:
        for u in entity_updates:
            cur.execute("""
                UPDATE graph_entities SET
                    community_id = %s,
                    degree = %s,
                    pagerank = %s
                WHERE entity_id = %s AND user_id = %s
            """, (
                u.get("community_id", 0),
                u.get("degree", 0),
                u.get("pagerank", 1.0),
                u["entity_id"],
                user_id
            ))

def sync_and_prune_graph(user_id: str, active_filenames: list[str]):
    """Prunes any entities, relations, and communities that do not belong to active vault documents."""
    active_set = [f.strip() for f in active_filenames if f and f.strip()]
    with connection() as conn, conn.cursor() as cur:
        if not active_set:
            # If no active files in vault, clear entire user graph
            cur.execute("DELETE FROM graph_relations WHERE user_id=%s", (user_id,))
            cur.execute("DELETE FROM graph_entities WHERE user_id=%s", (user_id,))
            cur.execute("DELETE FROM graph_communities WHERE user_id=%s", (user_id,))
            return

        # 1. Delete relations originating from deleted/inactive documents
        cur.execute("""
            DELETE FROM graph_relations
            WHERE user_id = %s AND NOT (source_doc = ANY(%s))
        """, (user_id, active_set))

        # 2. Prune inactive document names from graph_entities.source_docs
        cur.execute("""
            UPDATE graph_entities
            SET source_docs = (
                SELECT COALESCE(array_agg(elem), '{}'::text[])
                FROM unnest(source_docs) AS elem
                WHERE elem = ANY(%s)
            )
            WHERE user_id = %s
        """, (active_set, user_id))

        # 3. Delete orphan entities that have no active source docs AND no active relations
        cur.execute("""
            DELETE FROM graph_entities
            WHERE user_id = %s
            AND (source_docs IS NULL OR cardinality(source_docs) = 0 OR source_docs = '{}'::text[])
            AND entity_id NOT IN (SELECT source_entity_id FROM graph_relations WHERE user_id = %s)
            AND entity_id NOT IN (SELECT target_entity_id FROM graph_relations WHERE user_id = %s)
        """, (user_id, user_id, user_id))

        # 4. If no entities remain, clean up communities
        cur.execute("SELECT COUNT(*) FROM graph_entities WHERE user_id = %s", (user_id,))
        ent_count = cur.fetchone()["count"]
        if ent_count == 0:
            cur.execute("DELETE FROM graph_communities WHERE user_id = %s", (user_id,))

    # 5. Run automatic cross-document entity resolution & semantic deduplication
    run_entity_resolution_and_deduplication(user_id)

def run_entity_resolution_and_deduplication(user_id: str | None = None) -> int:
    """Discovers and merges duplicate entities across different documents based on stems, aliases, and name prefixes.
    Redirects all graph relations to the canonical primary entity and prevents fragmented graphs.
    """
    import re
    from collections import defaultdict

    uid = user_id or get_current_user()

    def normalize_entity_stem(name: str) -> str:
        s = name.lower().strip()
        s = re.sub(r'^(?:dr|prof|mr|mrs|ms)\.?\s+', '', s)
        for r in [
            r'software\s+engineering\s+intern',
            r'software\s+engineer',
            r'software\s+developer',
            r'full[- ]stack\s+developer',
            r'full[- ]stack\s+engineer',
            r'backend\s+developer',
            r'frontend\s+developer',
            r'data\s+scientist',
            r'ai\s+engineer',
            r'intern',
            r'student',
            r'consultant',
            r'researcher',
            r'architect',
            r'lead',
            r'manager'
        ]:
            s = re.sub(rf'\s+(?:-\s+|\|\s+|at\s+|,\s+)?{r}.*$', '', s)
        s = re.sub(r'\.js$', '', s)
        return re.sub(r'[^a-z0-9]', '', s)

    with connection() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT entity_id, canonical_name, entity_type, description, aliases, source_docs
            FROM graph_entities
            WHERE user_id = %s
        """, (uid,))
        entities = cur.fetchall()

        stem_groups = defaultdict(list)
        for ent in entities:
            stem = normalize_entity_stem(ent['canonical_name'])
            if len(stem) >= 3:
                stem_groups[stem].append(ent)

        merged_count = 0
        for stem, group in stem_groups.items():
            if len(group) <= 1:
                continue

            def score_entity(e):
                type_score = 0
                if e['entity_type'] == 'Person': type_score = 40
                elif e['entity_type'] == 'Organization': type_score = 30
                elif e['entity_type'] == 'Technology': type_score = 20
                elif e['entity_type'] == 'System': type_score = 15
                elif e['entity_type'] != 'Concept': type_score = 10
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
                    UPDATE graph_relations
                    SET source_entity_id = %s
                    WHERE user_id = %s AND source_entity_id = %s
                """, (primary_id, uid, sec_id))

                # Redirect relations where secondary was target
                cur.execute("""
                    UPDATE graph_relations
                    SET target_entity_id = %s
                    WHERE user_id = %s AND target_entity_id = %s
                """, (primary_id, uid, sec_id))

                # Delete redundant secondary entity
                cur.execute("""
                    DELETE FROM graph_entities
                    WHERE user_id = %s AND entity_id = %s
                """, (uid, sec_id))
                merged_count += 1

            # Clean self-referencing loops created by merge
            cur.execute("""
                DELETE FROM graph_relations
                WHERE user_id = %s AND source_entity_id = target_entity_id
            """, (uid,))

            # Deduplicate parallel relations
            cur.execute("""
                DELETE FROM graph_relations a USING graph_relations b
                WHERE a.ctid < b.ctid
                  AND a.user_id = b.user_id
                  AND a.source_entity_id = b.source_entity_id
                  AND a.target_entity_id = b.target_entity_id
                  AND a.relation_type = b.relation_type
                  AND a.user_id = %s
            """, (uid,))

            # Update primary canonical entity with merged attributes
            cur.execute("""
                UPDATE graph_entities
                SET source_docs = %s,
                    aliases = %s,
                    description = %s,
                    updated_at = now()
                WHERE user_id = %s AND entity_id = %s
            """, (list(all_source_docs), list(all_aliases), best_desc, uid, primary_id))

        if merged_count > 0:
            print(f"[GraphDB] Resolved and unified {merged_count} fragmented entities for user {uid}")
            try:
                from src.cache import invalidate_user_cache
                invalidate_user_cache(uid)
            except Exception:
                pass

        return merged_count

def delete_document_graph(filename: str):
    """Deletes graph edges and disconnected nodes originating solely from a deleted document."""
    user_id = get_current_user()
    filename_clean = filename.strip()
    with connection() as conn, conn.cursor() as cur:
        # Delete relations for this document
        cur.execute("DELETE FROM graph_relations WHERE user_id=%s AND source_doc=%s", (user_id, filename_clean))
        
        # Remove document from source_docs array
        cur.execute("""
            UPDATE graph_entities
            SET source_docs = array_remove(source_docs, %s)
            WHERE user_id=%s AND %s = ANY(source_docs)
        """, (filename_clean, user_id, filename_clean))
        
        # Delete orphan entities that have no remaining source docs and no remaining relations
        cur.execute("""
            DELETE FROM graph_entities
            WHERE user_id=%s
            AND (source_docs IS NULL OR cardinality(source_docs) = 0 OR source_docs = '{}'::text[])
            AND entity_id NOT IN (SELECT source_entity_id FROM graph_relations WHERE user_id=%s)
            AND entity_id NOT IN (SELECT target_entity_id FROM graph_relations WHERE user_id=%s)
        """, (user_id, user_id, user_id))

        # Check remaining entity count; if 0, clear communities
        cur.execute("SELECT COUNT(*) FROM graph_entities WHERE user_id=%s", (user_id,))
        ent_count = cur.fetchone()["count"]
        if ent_count == 0:
            cur.execute("DELETE FROM graph_communities WHERE user_id=%s", (user_id,))

    try:
        from src.cache import invalidate_user_cache
        invalidate_user_cache(user_id)
    except Exception:
        pass

def clear_user_graph():
    """Deletes all knowledge graph data for the current user."""
    user_id = get_current_user()
    with connection() as conn, conn.cursor() as cur:
        # Delete relations first (due to foreign key constraints)
        cur.execute("DELETE FROM graph_relations WHERE user_id=%s", (user_id,))
        # Delete entities
        cur.execute("DELETE FROM graph_entities WHERE user_id=%s", (user_id,))
        # Delete communities
        cur.execute("DELETE FROM graph_communities WHERE user_id=%s", (user_id,))

    try:
        from src.cache import invalidate_user_cache
        invalidate_user_cache(user_id)
    except Exception:
        pass

    print(f"[GraphDB] Cleared all knowledge graph data for user {user_id}")
