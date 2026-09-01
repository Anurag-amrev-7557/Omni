"""User-scoped chat persistence in Supabase Postgres."""
import json
import uuid
from psycopg.types.json import Jsonb
from src.auth import get_current_user
from src.state_db import connection

def init_chat_db():
    with connection() as conn, conn.cursor() as cur:
        cur.execute("""CREATE TABLE IF NOT EXISTS chat_sessions (
            session_id UUID PRIMARY KEY, user_id UUID NOT NULL, title TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
        cur.execute("""CREATE TABLE IF NOT EXISTS chat_messages (
            message_id UUID PRIMARY KEY, session_id UUID NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL,
            contexts_json JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id, created_at DESC)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at)")

def create_session(title: str = "New Chat") -> str:
    session_id = str(uuid.uuid4())
    with connection() as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO chat_sessions (session_id,user_id,title) VALUES (%s,%s,%s)", (session_id, get_current_user(), title))
    return session_id

def get_all_sessions() -> list[dict]:
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT session_id::text, title, created_at FROM chat_sessions WHERE user_id=%s ORDER BY created_at DESC", (get_current_user(),))
        return [dict(row) for row in cur.fetchall()]

def add_message(session_id: str, role: str, content: str, contexts: list[dict] | None = None):
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM chat_sessions WHERE session_id=%s AND user_id=%s", (session_id, get_current_user()))
        if cur.fetchone() is None:
            title = (content[:30] + ("..." if len(content) > 30 else "")) if role == "user" else "New Chat"
            cur.execute("INSERT INTO chat_sessions (session_id,user_id,title) VALUES (%s,%s,%s) ON CONFLICT (session_id) DO NOTHING", (session_id, get_current_user(), title))
        elif role == "user":
            cur.execute("SELECT count(*) AS message_count FROM chat_messages WHERE session_id=%s", (session_id,))
            if cur.fetchone()["message_count"] == 0:
                cur.execute("UPDATE chat_sessions SET title=%s WHERE session_id=%s", (content[:30] + ("..." if len(content) > 30 else ""), session_id))
        cur.execute("INSERT INTO chat_messages (message_id,session_id,role,content,contexts_json) VALUES (%s,%s,%s,%s,%s)", (str(uuid.uuid4()), session_id, role, content, Jsonb(contexts) if contexts else None))

def get_session_messages(session_id: str) -> list[dict]:
    try:
        with connection() as conn, conn.cursor() as cur:
            cur.execute("""SELECT m.role,m.content,m.contexts_json FROM chat_messages m JOIN chat_sessions s ON s.session_id=m.session_id
                WHERE m.session_id=%s AND s.user_id=%s ORDER BY m.created_at""", (session_id, get_current_user()))
            return [{"role": r["role"], "content": r["content"], **({"contexts": r["contexts_json"]} if r["contexts_json"] else {})} for r in cur.fetchall()]
    except Exception:
        return []

def delete_session(session_id: str):
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM chat_sessions WHERE session_id=%s AND user_id=%s", (session_id, get_current_user()))
