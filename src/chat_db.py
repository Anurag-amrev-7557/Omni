"""
Unified Chat History Database with PostgreSQL (Neon/Supabase) and SQLite Fallback.

Supports seamless persistence on cloud deployments (Render) and local offline development.
Guarantees valid UUID format for PostgreSQL schema compatibility across both authenticated
Supabase users and guest sessions.
"""

import os
import json
import uuid
import sqlite3
from datetime import datetime
from typing import Optional, List, Dict, Any

DEFAULT_LOCAL_USER = "10d2f529-3fae-4a29-9a5e-312876700ff9"
SQLITE_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "chat_history.db")

def normalize_user_id(user_id: Optional[str]) -> str:
    """Ensures user_id is a valid UUID string.
    
    If given a string that is not already a UUID (e.g. 'guest_abc123', 'default_user'),
    converts it deterministically to a UUIDv5.
    """
    if not user_id or user_id in ("default_user", "local", "guest"):
        return DEFAULT_LOCAL_USER
    try:
        return str(uuid.UUID(str(user_id)))
    except (ValueError, TypeError):
        return str(uuid.uuid5(uuid.NAMESPACE_DNS, str(user_id)))

def _get_postgres_url() -> Optional[str]:
    url = os.getenv("DATABASE_URL") or os.getenv("NEON_DATABASE_URL", "").strip()
    if not url:
        try:
            from dotenv import load_dotenv
            load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
            url = os.getenv("DATABASE_URL") or os.getenv("NEON_DATABASE_URL", "").strip()
        except Exception:
            pass
    return url if url else None

_pg_pool = None

def _get_pg_pool():
    global _pg_pool
    if _pg_pool is None:
        url = _get_postgres_url()
        if url:
            try:
                import psycopg2.pool
                _pg_pool = psycopg2.pool.ThreadedConnectionPool(minconn=1, maxconn=10, dsn=url)
            except Exception as e:
                print(f"[ChatDB] Connection pool notice: {e}")
    return _pg_pool

def _get_pg_connection():
    pool = _get_pg_pool()
    if pool:
        try:
            return pool.getconn()
        except Exception:
            pass
    import psycopg2
    url = _get_postgres_url()
    if not url:
        return None
    return psycopg2.connect(url, connect_timeout=10)

def _release_pg_connection(conn):
    if not conn:
        return
    pool = _get_pg_pool()
    if pool:
        try:
            pool.putconn(conn)
            return
        except Exception:
            pass
    try:
        conn.close()
    except Exception:
        pass

def _get_sqlite_connection():
    os.makedirs(os.path.dirname(SQLITE_DB_PATH), exist_ok=True)
    conn = sqlite3.connect(SQLITE_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

_chat_db_initialized = False

def init_chat_db():
    """Initializes tables in PostgreSQL (if configured) or SQLite once per process."""
    global _chat_db_initialized
    if _chat_db_initialized:
        return
    _chat_db_initialized = True

    pg_url = _get_postgres_url()
    if pg_url:
        conn = _get_pg_connection()
        if conn:
            try:
                cur = conn.cursor()
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS chat_sessions (
                        session_id UUID PRIMARY KEY,
                        user_id UUID NOT NULL,
                        title TEXT NOT NULL DEFAULT 'New Chat',
                        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                    );
                """)
                cur.execute("""
                    CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id ON chat_sessions(user_id);
                """)
                cur.execute("""
                    CREATE INDEX IF NOT EXISTS idx_chat_sessions_created_at ON chat_sessions(created_at DESC);
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS chat_messages (
                        message_id UUID PRIMARY KEY,
                        session_id UUID NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
                        role TEXT NOT NULL,
                        content TEXT NOT NULL,
                        contexts_json JSONB,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                    );
                """)
                cur.execute("""
                    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);
                """)
                cur.execute("""
                    CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at ASC);
                """)
                conn.commit()
                print("[ChatDB] ✓ PostgreSQL chat tables verified")
                return
            except Exception as e:
                print(f"[ChatDB] PostgreSQL init notice: {e}. Falling back to SQLite.")
            finally:
                _release_pg_connection(conn)

    # SQLite fallback
    conn = _get_sqlite_connection()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            user_id TEXT NOT NULL DEFAULT '10d2f529-3fae-4a29-9a5e-312876700ff9',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    try:
        cur.execute("ALTER TABLE sessions ADD COLUMN user_id TEXT DEFAULT '10d2f529-3fae-4a29-9a5e-312876700ff9'")
    except Exception:
        pass
    cur.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            contexts TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES sessions (session_id)
        )
    """)
    conn.commit()
    conn.close()

def create_session(title: str = "New Chat", user_id: Optional[str] = None, session_id: Optional[str] = None) -> str:
    init_chat_db()
    if not session_id:
        session_id = str(uuid.uuid4())
    norm_user = normalize_user_id(user_id)
    pg_url = _get_postgres_url()
    
    if pg_url:
        conn = _get_pg_connection()
        if conn:
            try:
                cur = conn.cursor()
                cur.execute(
                    """
                    INSERT INTO chat_sessions (session_id, user_id, title, created_at) 
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (session_id) DO UPDATE SET title = EXCLUDED.title
                    """,
                    (session_id, norm_user, title, datetime.now())
                )
                conn.commit()
                return session_id
            except Exception as e:
                print(f"[ChatDB] PostgreSQL create_session error: {e}, falling back to SQLite")
            finally:
                _release_pg_connection(conn)

    conn = _get_sqlite_connection()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO sessions (session_id, title, user_id, created_at) 
        VALUES (?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET title = excluded.title
        """,
        (session_id, title, norm_user, datetime.now().isoformat())
    )
    conn.commit()
    conn.close()
    return session_id

def get_all_sessions(user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    init_chat_db()
    norm_user = normalize_user_id(user_id) if user_id else None
    pg_url = _get_postgres_url()

    if pg_url:
        conn = _get_pg_connection()
        if conn:
            try:
                cur = conn.cursor()
                if norm_user:
                    cur.execute(
                        """
                        SELECT s.session_id, s.title, s.created_at, COUNT(m.message_id) as msg_count
                        FROM chat_sessions s
                        LEFT JOIN chat_messages m ON s.session_id = m.session_id
                        WHERE s.user_id = %s
                        GROUP BY s.session_id, s.title, s.created_at
                        ORDER BY s.created_at DESC
                        """,
                        (norm_user,)
                    )
                else:
                    cur.execute(
                        """
                        SELECT s.session_id, s.title, s.created_at, COUNT(m.message_id) as msg_count
                        FROM chat_sessions s
                        LEFT JOIN chat_messages m ON s.session_id = m.session_id
                        GROUP BY s.session_id, s.title, s.created_at
                        ORDER BY s.created_at DESC
                        """
                    )
                rows = cur.fetchall()
                return [
                    {
                        "session_id": str(r[0]),
                        "title": r[1],
                        "created_at": r[2].isoformat() if hasattr(r[2], "isoformat") else str(r[2])
                    }
                    for r in rows
                ]
            except Exception as e:
                print(f"[ChatDB] PostgreSQL get_all_sessions error: {e}")
            finally:
                _release_pg_connection(conn)

    conn = _get_sqlite_connection()
    cur = conn.cursor()
    if norm_user:
        cur.execute(
            """
            SELECT s.session_id, s.title, s.created_at, COUNT(m.session_id) as msg_count
            FROM sessions s
            LEFT JOIN messages m ON s.session_id = m.session_id
            WHERE (s.user_id = ? OR s.user_id = ?)
            GROUP BY s.session_id, s.title, s.created_at
            ORDER BY s.created_at DESC
            """,
            (norm_user, user_id)
        )
    else:
        cur.execute(
            """
            SELECT s.session_id, s.title, s.created_at, COUNT(m.session_id) as msg_count
            FROM sessions s
            LEFT JOIN messages m ON s.session_id = m.session_id
            GROUP BY s.session_id, s.title, s.created_at
            ORDER BY s.created_at DESC
            """
        )
    rows = cur.fetchall()
    conn.close()
    return [
        {
            "session_id": r["session_id"],
            "title": r["title"],
            "created_at": r["created_at"]
        }
        for r in rows
    ]

# Fast in-memory message cache to eliminate blocking remote database roundtrips during chat
_messages_cache: Dict[str, List[Dict[str, Any]]] = {}

def _persist_message_to_db(session_id: str, role: str, content: str, contexts: Optional[List[dict]] = None):
    message_id = str(uuid.uuid4())
    pg_url = _get_postgres_url()

    if pg_url:
        conn = _get_pg_connection()
        if conn:
            try:
                cur = conn.cursor()
                # Ensure parent session exists to prevent foreign key violation
                cur.execute("SELECT 1 FROM chat_sessions WHERE session_id = %s", (session_id,))
                if not cur.fetchone():
                    short_title = content[:30] + ("..." if len(content) > 30 else "")
                    cur.execute(
                        "INSERT INTO chat_sessions (session_id, user_id, title, created_at) VALUES (%s, %s, %s, %s) ON CONFLICT (session_id) DO NOTHING",
                        (session_id, DEFAULT_LOCAL_USER, short_title, datetime.now())
                    )

                # Update title on first message if needed
                if role == "user":
                    cur.execute("SELECT count(*) FROM chat_messages WHERE session_id = %s", (session_id,))
                    count = cur.fetchone()[0]
                    if count == 0:
                        short_title = content[:30] + ("..." if len(content) > 30 else "")
                        cur.execute("UPDATE chat_sessions SET title = %s WHERE session_id = %s", (short_title, session_id))

                contexts_json = json.dumps(contexts) if contexts else None
                cur.execute(
                    "INSERT INTO chat_messages (message_id, session_id, role, content, contexts_json, created_at) VALUES (%s, %s, %s, %s, %s, %s)",
                    (message_id, session_id, role, content, contexts_json, datetime.now())
                )
                conn.commit()
                return
            except Exception as e:
                print(f"[ChatDB] PostgreSQL add_message error: {e}")
            finally:
                _release_pg_connection(conn)

    conn = _get_sqlite_connection()
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM sessions WHERE session_id = ?", (session_id,))
    if not cur.fetchone():
        short_title = content[:30] + ("..." if len(content) > 30 else "")
        cur.execute(
            "INSERT INTO sessions (session_id, title, user_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(session_id) DO NOTHING",
            (session_id, short_title, DEFAULT_LOCAL_USER, datetime.now().isoformat())
        )

    if role == "user":
        cur.execute("SELECT COUNT(*) as count FROM messages WHERE session_id = ?", (session_id,))
        count = cur.fetchone()["count"]
        if count == 0:
            short_title = content[:30] + ("..." if len(content) > 30 else "")
            cur.execute("UPDATE sessions SET title = ? WHERE session_id = ?", (short_title, session_id))

    contexts_json = json.dumps(contexts) if contexts else None
    cur.execute(
        "INSERT INTO messages (message_id, session_id, role, content, contexts_json, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
        (message_id, session_id, role, content, contexts_json, datetime.now().isoformat())
    )
    conn.commit()
    conn.close()

def add_message(session_id: str, role: str, content: str, contexts: Optional[List[dict]] = None):
    """Synchronously appends to memory cache and writes to database."""
    if session_id not in _messages_cache:
        _messages_cache[session_id] = []
    _messages_cache[session_id].append({"role": role, "content": content, "contexts": contexts})
    _persist_message_to_db(session_id, role, content, contexts)

def save_message_async(session_id: str, role: str, content: str, contexts: Optional[List[dict]] = None):
    """Immediately updates in-memory cache and dispatches background persistence to keep chat latency sub-second."""
    if session_id not in _messages_cache:
        _messages_cache[session_id] = []
    _messages_cache[session_id].append({"role": role, "content": content, "contexts": contexts})
    
    import threading
    threading.Thread(target=_persist_message_to_db, args=(session_id, role, content, contexts), daemon=True).start()

def get_session_messages(session_id: str) -> List[Dict[str, Any]]:
    # Fast path: in-memory cache hit
    if session_id in _messages_cache:
        return [dict(m) for m in _messages_cache[session_id]]

    pg_url = _get_postgres_url()
    if pg_url:
        conn = _get_pg_connection()
        if conn:
            try:
                cur = conn.cursor()
                cur.execute(
                    "SELECT role, content, contexts_json FROM chat_messages WHERE session_id = %s ORDER BY created_at ASC",
                    (session_id,)
                )
                rows = cur.fetchall()
                messages = []
                for r in rows:
                    msg = {"role": r[0], "content": r[1]}
                    if r[2]:
                        try:
                            msg["contexts"] = r[2] if isinstance(r[2], (list, dict)) else json.loads(r[2])
                        except Exception:
                            msg["contexts"] = None
                    messages.append(msg)
                _messages_cache[session_id] = [dict(m) for m in messages]
                return messages
            except Exception as e:
                print(f"[ChatDB] PostgreSQL get_session_messages error: {e}")
            finally:
                _release_pg_connection(conn)

    conn = _get_sqlite_connection()
    cur = conn.cursor()
    cur.execute("SELECT role, content, contexts_json FROM messages WHERE session_id = ? ORDER BY timestamp ASC", (session_id,))
    rows = cur.fetchall()
    conn.close()

    messages = []
    for r in rows:
        msg = {"role": r["role"], "content": r["content"]}
        if r["contexts_json"]:
            try:
                msg["contexts"] = json.loads(r["contexts_json"])
            except Exception:
                msg["contexts"] = None
        messages.append(msg)
    _messages_cache[session_id] = [dict(m) for m in messages]
    return messages

def delete_session(session_id: str):
    _messages_cache.pop(session_id, None)
    pg_url = _get_postgres_url()
    if pg_url:
        conn = _get_pg_connection()
        if conn:
            try:
                cur = conn.cursor()
                cur.execute("DELETE FROM chat_messages WHERE session_id = %s", (session_id,))
                cur.execute("DELETE FROM chat_sessions WHERE session_id = %s", (session_id,))
                conn.commit()
                return
            except Exception as e:
                print(f"[ChatDB] PostgreSQL delete_session error: {e}")
            finally:
                _release_pg_connection(conn)

    conn = _get_sqlite_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
    cur.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
    conn.commit()
    conn.close()

def delete_user_sessions(user_id: str):
    if not user_id:
        return
    _messages_cache.clear()
    norm_user = normalize_user_id(user_id)
    pg_url = _get_postgres_url()
    if pg_url:
        conn = _get_pg_connection()
        if conn:
            try:
                cur = conn.cursor()
                cur.execute(
                    "DELETE FROM chat_messages WHERE session_id IN (SELECT session_id FROM chat_sessions WHERE user_id = %s)",
                    (norm_user,)
                )
                cur.execute("DELETE FROM chat_sessions WHERE user_id = %s", (norm_user,))
                conn.commit()
                return
            except Exception as e:
                print(f"[ChatDB] PostgreSQL delete_user_sessions error: {e}")
            finally:
                _release_pg_connection(conn)

    conn = _get_sqlite_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM messages WHERE session_id IN (SELECT session_id FROM sessions WHERE user_id = ? OR user_id = ?)", (norm_user, user_id))
    cur.execute("DELETE FROM sessions WHERE user_id = ? OR user_id = ?", (norm_user, user_id))
    conn.commit()
    conn.close()

