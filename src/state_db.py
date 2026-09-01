"""Durable Postgres state for documents and ingestion jobs."""
import os
import psycopg
from psycopg.rows import dict_row

DATABASE_URL = os.getenv("DATABASE_URL")

def connection():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not configured")
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)

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
        cur.execute("CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_upload_jobs_user ON upload_jobs(user_id)")

def upsert_document(user_id, filename, status, **values):
    with connection() as conn, conn.cursor() as cur:
        cur.execute("""INSERT INTO documents (user_id, filename, status, size_bytes, page_count, chunk_count, error)
        VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (user_id,filename) DO UPDATE SET
        status=EXCLUDED.status,size_bytes=EXCLUDED.size_bytes,page_count=EXCLUDED.page_count,
        chunk_count=EXCLUDED.chunk_count,error=EXCLUDED.error,updated_at=now()""",
        (user_id, filename, status, values.get('size_bytes'), values.get('page_count'), values.get('chunk_count'), values.get('error')))
