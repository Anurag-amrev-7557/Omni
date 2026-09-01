"""Durable Postgres state for documents, ingestion jobs, feedback, and connection pooling."""
import os
import uuid
import contextlib
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

_pool = None

def get_database_url() -> str:
    return os.getenv("DATABASE_URL") or ""

def get_connection_pool():
    global _pool
    if _pool is not None:
        return _pool
    db_url = get_database_url()
    if not db_url:
        return None
    try:
        from psycopg_pool import ConnectionPool
        _pool = ConnectionPool(
            conninfo=db_url,
            min_size=1,
            max_size=10,
            timeout=10.0,
            kwargs={"row_factory": dict_row}
        )
        return _pool
    except Exception as exc:
        print(f"[Warning] Could not initialize psycopg_pool ({exc}). Using direct connections.")
        return None

@contextlib.contextmanager
def connection():
    pool = get_connection_pool()
    if pool is not None:
        with pool.connection() as conn:
            yield conn
    else:
        db_url = get_database_url()
        if not db_url:
            raise RuntimeError("DATABASE_URL is not configured")
        with psycopg.connect(db_url, row_factory=dict_row) as conn:
            yield conn

def init_state_db():
    with connection() as conn, conn.cursor() as cur:
        cur.execute("""CREATE TABLE IF NOT EXISTS documents (
            user_id UUID NOT NULL,
            filename TEXT NOT NULL, storage_key TEXT, size_bytes BIGINT,
            page_count INTEGER, chunk_count INTEGER, status TEXT NOT NULL,
            error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(user_id, filename))""")
        cur.execute("""CREATE TABLE IF NOT EXISTS upload_jobs (
            id UUID PRIMARY KEY, user_id UUID NOT NULL, status TEXT NOT NULL,
            total_files INTEGER NOT NULL, completed_files INTEGER NOT NULL DEFAULT 0,
            details JSONB NOT NULL DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
        cur.execute("""CREATE TABLE IF NOT EXISTS chat_feedback (
            id UUID PRIMARY KEY, user_id UUID NOT NULL, session_id UUID,
            message_id TEXT, rating BOOLEAN NOT NULL, feedback TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_upload_jobs_user ON upload_jobs(user_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_feedback_user ON chat_feedback(user_id, created_at DESC)")

def upsert_document(user_id, filename, status, **values):
    with connection() as conn, conn.cursor() as cur:
        cur.execute("""INSERT INTO documents (user_id, filename, status, size_bytes, page_count, chunk_count, error)
        VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (user_id,filename) DO UPDATE SET
        status=EXCLUDED.status,size_bytes=EXCLUDED.size_bytes,page_count=EXCLUDED.page_count,
        chunk_count=EXCLUDED.chunk_count,error=EXCLUDED.error,updated_at=now()""",
        (user_id, filename, status, values.get('size_bytes'), values.get('page_count'), values.get('chunk_count'), values.get('error')))

def delete_document_record(user_id, filename):
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM documents WHERE user_id=%s AND filename=%s", (user_id, filename))

def save_upload_job(job_id, user_id, status, total_files, completed_files, details):
    with connection() as conn, conn.cursor() as cur:
        cur.execute("""INSERT INTO upload_jobs (id,user_id,status,total_files,completed_files,details)
        VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,
        completed_files=EXCLUDED.completed_files,details=EXCLUDED.details,updated_at=now()""",
        (job_id, user_id, status, total_files, completed_files, Jsonb(details)))

def get_upload_job(job_id, user_id):
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT id::text AS upload_id,status,total_files,completed_files,details AS files FROM upload_jobs WHERE id=%s AND user_id=%s", (job_id, user_id))
        return cur.fetchone()

def save_feedback(user_id: str, session_id: str | None, message_id: str | None, rating: bool, feedback: str | None = None):
    feedback_id = str(uuid.uuid4())
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO chat_feedback (id, user_id, session_id, message_id, rating, feedback)
            VALUES (%s, %s, %s, %s, %s, %s)""",
            (feedback_id, user_id, session_id, message_id, rating, feedback)
        )
    return feedback_id
