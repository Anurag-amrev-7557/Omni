"""Document Metadata Database Layer with PostgreSQL and SQLite Local Fallback.

Tracks document statuses ('indexing', 'ready', 'failed'), page counts, file sizes,
and chunk counts with strict per-user tenant isolation.
"""
from datetime import datetime
from typing import Optional, List, Dict, Any

from src.config.settings import settings
from src.core.logging import logger
from src.core.security import normalize_user_id, is_default_or_local_user
from src.storage.relational_db import get_db_cursor

_docs_db_initialized = False


def init_docs_db():
    """Initializes the documents metadata table in PostgreSQL or SQLite."""
    global _docs_db_initialized
    if _docs_db_initialized:
        return
    _docs_db_initialized = True

    try:
        with get_db_cursor(commit=True) as (conn, cur, p):
            if p == "%s":
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS documents (
                        id SERIAL PRIMARY KEY,
                        filename TEXT NOT NULL,
                        user_id UUID NOT NULL,
                        size_bytes BIGINT DEFAULT 0,
                        page_count INT DEFAULT 1,
                        status TEXT DEFAULT 'ready',
                        summary TEXT,
                        chunk_count INT DEFAULT 0,
                        error TEXT,
                        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE (filename, user_id)
                    );
                    CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
                    CREATE INDEX IF NOT EXISTS idx_documents_filename ON documents(filename);
                """)
            else:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS documents (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        filename TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        size_bytes INTEGER DEFAULT 0,
                        page_count INTEGER DEFAULT 1,
                        status TEXT DEFAULT 'ready',
                        summary TEXT,
                        chunk_count INTEGER DEFAULT 0,
                        error TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE (filename, user_id)
                    );
                """)
                cur.execute("CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_documents_filename ON documents(filename);")
    except Exception as e:
        logger.error(f"init_docs_db error: {e}")


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
    now = datetime.now()

    try:
        with get_db_cursor(commit=True) as (conn, cur, p):
            ts = now if p == "%s" else now.isoformat()
            cur.execute(f"""
                INSERT INTO documents (filename, user_id, size_bytes, page_count, status, summary, chunk_count, created_at, updated_at)
                VALUES ({p}, {p}, {p}, {p}, {p}, {p}, {p}, {p}, {p})
                ON CONFLICT (filename, user_id) DO UPDATE SET
                    size_bytes = EXCLUDED.size_bytes,
                    page_count = EXCLUDED.page_count,
                    status = EXCLUDED.status,
                    summary = COALESCE(EXCLUDED.summary, documents.summary),
                    chunk_count = EXCLUDED.chunk_count,
                    error = NULL,
                    updated_at = EXCLUDED.updated_at
            """, (filename, norm_user, size_bytes, page_count, status, summary, chunk_count, ts, ts))
            return True
    except Exception as e:
        logger.error(f"upsert_document_record error for {filename}: {e}")
        return False


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
    now = datetime.now()

    try:
        with get_db_cursor(commit=True) as (conn, cur, p):
            ts = now if p == "%s" else now.isoformat()
            cur.execute(f"""
                UPDATE documents
                SET status = {p}, chunk_count = {p}, error = {p}, summary = COALESCE({p}, summary), updated_at = {p}
                WHERE filename = {p} AND user_id = {p}
            """, (status, chunk_count, error, summary, ts, filename, norm_user))
            return True
    except Exception as e:
        logger.error(f"update_document_status error for {filename}: {e}")
        return False


def get_user_documents(user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Retrieves document records strictly belonging to the specified user."""
    init_docs_db()
    norm_user = normalize_user_id(user_id)
    is_local = is_default_or_local_user(user_id)

    try:
        with get_db_cursor() as (conn, cur, p):
            order_clause = "ORDER BY updated_at DESC NULLS LAST" if p == "%s" else "ORDER BY updated_at DESC"
            if is_local:
                cur.execute(f"""
                    SELECT filename, size_bytes, page_count, status, summary, chunk_count, error, updated_at
                    FROM documents
                    WHERE user_id = {p} OR user_id = {p}
                    {order_clause}
                """, (norm_user, settings.DEFAULT_LOCAL_USER))
            else:
                cur.execute(f"""
                    SELECT filename, size_bytes, page_count, status, summary, chunk_count, error, updated_at
                    FROM documents
                    WHERE user_id = {p}
                    {order_clause}
                """, (norm_user,))
            rows = cur.fetchall()
            return _format_doc_rows(rows)
    except Exception as e:
        logger.error(f"get_user_documents error: {e}")
        return []


def _format_doc_rows(rows: list) -> List[Dict[str, Any]]:
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


def delete_document_records(filenames: List[str], user_id: Optional[str] = None) -> bool:
    """Deletes document records strictly belonging to the requesting user."""
    if not filenames:
        return True
    init_docs_db()
    norm_user = normalize_user_id(user_id)
    is_local = is_default_or_local_user(user_id)

    try:
        with get_db_cursor(commit=True) as (conn, cur, p):
            if p == "%s":
                if is_local:
                    cur.execute("""
                        DELETE FROM documents
                        WHERE filename = ANY(%s) AND (user_id = %s OR user_id = %s)
                    """, (filenames, norm_user, settings.DEFAULT_LOCAL_USER))
                else:
                    cur.execute("""
                        DELETE FROM documents
                        WHERE filename = ANY(%s) AND user_id = %s
                    """, (filenames, norm_user))
            else:
                placeholders = ",".join("?" for _ in filenames)
                if is_local:
                    cur.execute(f"""
                        DELETE FROM documents
                        WHERE filename IN ({placeholders}) AND (user_id = ? OR user_id = ?)
                    """, filenames + [norm_user, settings.DEFAULT_LOCAL_USER])
                else:
                    cur.execute(f"""
                        DELETE FROM documents
                        WHERE filename IN ({placeholders}) AND user_id = ?
                    """, filenames + [norm_user])
            return True
    except Exception as e:
        logger.error(f"delete_document_records error: {e}")
        return False


def delete_document_record(filename: str, user_id: Optional[str] = None) -> bool:
    return delete_document_records([filename], user_id=user_id)
