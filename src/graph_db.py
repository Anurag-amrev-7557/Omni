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

            # Indexes for fast traversals
            cur.execute("CREATE INDEX IF NOT EXISTS idx_graph_entities_user ON graph_entities(user_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_graph_entities_comm ON graph_entities(user_id, community_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_graph_rel_source ON graph_relations(user_id, source_entity_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_graph_rel_target ON graph_relations(user_id, target_entity_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_graph_rel_doc ON graph_relations(user_id, source_doc)")
    except Exception as exc:
        print(f"[GraphDB] Error initializing graph tables: {exc}")

def upsert_entity(
    canonical_name: str,
    entity_type: str = "Concept",
    description: str = "",
    aliases: list[str] | None = None,
    source_doc: str | None = None,
) -> str:
    """Inserts or merges an entity into graph_entities."""
    user_id = get_current_user()
    aliases = aliases or []
    source_docs = [source_doc] if source_doc else []
    
    with connection() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO graph_entities (
                entity_id, user_id, canonical_name, entity_type, description, aliases, source_docs, updated_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, now()
            )
            ON CONFLICT (user_id, canonical_name) DO UPDATE SET
                entity_type = CASE WHEN EXCLUDED.entity_type != 'Concept' THEN EXCLUDED.entity_type ELSE graph_entities.entity_type END,
                description = CASE WHEN LENGTH(EXCLUDED.description) > LENGTH(graph_entities.description) THEN EXCLUDED.description ELSE graph_entities.description END,
                aliases = array_cat(graph_entities.aliases, EXCLUDED.aliases),
                source_docs = array_cat(graph_entities.source_docs, EXCLUDED.source_docs),
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
    """Adds a directed edge between two entities."""
    user_id = get_current_user()
    rel_id = str(uuid.uuid4())
    with connection() as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO graph_relations (
                relation_id, user_id, source_entity_id, target_entity_id,
                relation_type, weight, description, source_doc, page_num, snippet
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            ) RETURNING relation_id::text
        """, (
            rel_id, user_id, source_entity_id, target_entity_id,
            relation_type.upper().strip(), weight, description.strip(),
            source_doc.strip(), page_num, snippet.strip()
        ))
        row = cur.fetchone()
        return row["relation_id"] if row else rel_id

def get_user_graph() -> dict:
    """Returns the full knowledge graph (nodes, edges, communities, metrics) for current user."""
    user_id = get_current_user()
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
        links = [dict(r) for r in cur.fetchall()]

        # Fetch communities
        cur.execute("""
            SELECT community_id as id, level, title, summary, key_entities, findings
            FROM graph_communities WHERE user_id=%s ORDER BY level, community_id
        """, (user_id,))
        communities = [dict(r) for r in cur.fetchall()]

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

def delete_document_graph(filename: str):
    """Deletes graph edges and disconnected nodes originating solely from a deleted document."""
    user_id = get_current_user()
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM graph_relations WHERE user_id=%s AND source_doc=%s", (user_id, filename))
        # Remove document from source_docs array
        cur.execute("""
            UPDATE graph_entities
            SET source_docs = array_remove(source_docs, %s)
            WHERE user_id=%s AND %s = ANY(source_docs)
        """, (filename, user_id, filename))
        # Delete orphan entities that have no remaining source docs and 0 degree
        cur.execute("""
            DELETE FROM graph_entities
            WHERE user_id=%s AND cardinality(source_docs) = 0
            AND entity_id NOT IN (SELECT source_entity_id FROM graph_relations WHERE user_id=%s)
            AND entity_id NOT IN (SELECT target_entity_id FROM graph_relations WHERE user_id=%s)
        """, (user_id, user_id, user_id))

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
    print(f"[GraphDB] Cleared all knowledge graph data for user {user_id}")
