"""
Document Metadata Database Layer using PostgreSQL (Neon/Supabase) with SQLite/Local Fallback.

Tracks document statuses ('indexing', 'ready', 'failed'), page counts, file sizes,
and chunks across deployments.
"""

import os
import uuid
from datetime import datetime
from typing import Optional, List, Dict, Any
from src.chat_db import normalize_user_id, _get_postgres_url, _get_pg_connection, _release_pg_connection, DEFAULT_LOCAL_USER

_docs_db_initialized = False

def init_docs_db():
    """Initializes the documents metadata table in PostgreSQL if not present."""
    global _docs_db_initialized
    if _docs_db_initialized:
        return
    _docs_db_initialized = True

    pg_url = _get_postgres_url()
    if not pg_url:
        return

    conn = None
    try:
        conn = _get_pg_connection()
        if conn:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS documents (
                    id SERIAL PRIMARY KEY,
                    filename TEXT NOT NULL,
                    user_id UUID,
                    size_bytes BIGINT DEFAULT 0,
                    page_count INT DEFAULT 1,
                    status TEXT DEFAULT 'ready',
                    summary TEXT,
                    chunk_count INT DEFAULT 0,
                    error TEXT,
                    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
                CREATE INDEX IF NOT EXISTS idx_documents_filename ON documents(filename);
            """)
            conn.commit()
    except Exception as e:
        print(f"[DocsDB] Init notice: {e}")
    finally:
        if conn:
            _release_pg_connection(conn)

def upsert_document_record(
    filename: str,
    user_id: Optional[str] = None,
    size_bytes: int = 0,
    page_count: int = 1,
    status: str = "ready",
    summary: Optional[str] = None,
    chunk_count: int = 0,
) -> bool:
    init_docs_db()
    norm_user = normalize_user_id(user_id)
    pg_url = _get_postgres_url()
    if not pg_url:
        return False

    conn = None
    try:
        conn = _get_pg_connection()
        if not conn:
            return False
        cur = conn.cursor()
        # Check if record exists for this user and filename
        cur.execute(
            "SELECT id FROM documents WHERE filename = %s AND user_id = %s",
            (filename, norm_user)
        )
        row = cur.fetchone()
        now = datetime.now()
        if row:
            cur.execute(
                """
                UPDATE documents
                SET size_bytes = %s, page_count = %s, status = %s, summary = COALESCE(%s, summary),
                    chunk_count = %s, error = NULL, updated_at = %s
                WHERE id = %s
                """,
                (size_bytes, page_count, status, summary, chunk_count, now, row[0])
            )
        else:
            cur.execute(
                """
                INSERT INTO documents (filename, user_id, size_bytes, page_count, status, summary, chunk_count, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (filename, norm_user, size_bytes, page_count, status, summary, chunk_count, now, now)
            )
        conn.commit()
        return True
    except Exception as e:
        print(f"[DocsDB] Error upserting document {filename}: {e}")
        return False
    finally:
        if conn:
            _release_pg_connection(conn)

def update_document_status(
    filename: str,
    user_id: Optional[str] = None,
    status: str = "ready",
    chunk_count: int = 0,
    error: Optional[str] = None,
    summary: Optional[str] = None,
) -> bool:
    init_docs_db()
    norm_user = normalize_user_id(user_id)
    pg_url = _get_postgres_url()
    if not pg_url:
        return False

    conn = None
    try:
        conn = _get_pg_connection()
        if not conn:
            return False
        cur = conn.cursor()
        now = datetime.now()
        cur.execute(
            """
            UPDATE documents
            SET status = %s, chunk_count = %s, error = %s, summary = COALESCE(%s, summary), updated_at = %s
            WHERE filename = %s AND user_id = %s
            """,
            (status, chunk_count, error, summary, now, filename, norm_user)
        )
        conn.commit()
        return True
    except Exception as e:
        print(f"[DocsDB] Error updating status for {filename}: {e}")
        return False
    finally:
        if conn:
            _release_pg_connection(conn)

def get_user_documents(user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    init_docs_db()
    norm_user = normalize_user_id(user_id)
    pg_url = _get_postgres_url()
    if not pg_url:
        return []

    conn = None
    try:
        conn = _get_pg_connection()
        cur = conn.cursor()
        is_guest_or_local = (
            not user_id or
            user_id in ("default", "default_user", DEFAULT_LOCAL_USER) or
            str(user_id).startswith("guest_")
        )
        if is_guest_or_local:
            cur.execute(
                """
                SELECT filename, size_bytes, page_count, status, summary, chunk_count, error, updated_at
                FROM documents
                WHERE user_id = %s OR user_id = %s OR user_id IS NULL
                ORDER BY updated_at DESC NULLS LAST
                """,
                (norm_user, DEFAULT_LOCAL_USER)
            )
        else:
            cur.execute(
                """
                SELECT filename, size_bytes, page_count, status, summary, chunk_count, error, updated_at
                FROM documents
                WHERE user_id = %s OR user_id IS NULL
                ORDER BY updated_at DESC NULLS LAST
                """,
                (norm_user,)
            )
        rows = cur.fetchall()
        docs = []
        seen = set()
        for r in rows:
            fname = r[0]
            if fname in seen:
                continue
            seen.add(fname)
            size_mb = round((r[1] or 0) / (1024 * 1024), 2)
            docs.append({
                "filename": fname,
                "size_mb": size_mb,
                "pages": r[2] or 1,
                "status": r[3] or "ready",
                "summary": r[4] or "",
                "chunks": r[5] or 0,
                "error": r[6],
                "indexed": (r[3] or "ready") == "ready"
            })
        return docs
    except Exception as e:
        print(f"[DocsDB] Error fetching user documents: {e}")
        return []
    finally:
        if conn:
            _release_pg_connection(conn)

def delete_document_records(filenames: List[str], user_id: Optional[str] = None) -> bool:
    if not filenames:
        return True
    init_docs_db()
    norm_user = normalize_user_id(user_id)
    pg_url = _get_postgres_url()
    if not pg_url:
        return False

    conn = None
    try:
        conn = _get_pg_connection()
        if not conn:
            return False
        cur = conn.cursor()
        is_guest_or_local = (
            not user_id or
            user_id in ("default", "default_user", DEFAULT_LOCAL_USER) or
            str(user_id).startswith("guest_")
        )
        if is_guest_or_local:
            cur.execute(
                """
                DELETE FROM documents 
                WHERE filename = ANY(%s) 
                  AND (user_id = %s OR user_id = %s OR user_id IS NULL)
                """,
                (filenames, norm_user, DEFAULT_LOCAL_USER)
            )
        else:
            cur.execute(
                "DELETE FROM documents WHERE filename = ANY(%s) AND (user_id = %s OR user_id IS NULL)",
                (filenames, norm_user)
            )
        conn.commit()
        return True
    except Exception as e:
        print(f"[DocsDB] Error deleting document records: {e}")
        return False
    finally:
        if conn:
            _release_pg_connection(conn)

def delete_document_record(filename: str, user_id: Optional[str] = None) -> bool:
    return delete_document_records([filename], user_id=user_id)
