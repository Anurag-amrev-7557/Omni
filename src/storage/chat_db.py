"""Unified Chat History Database with PostgreSQL (Neon/Supabase) and SQLite Fallback.

Supports persistence on cloud deployments and offline local development with
strict per-user tenant isolation.
"""
import json
import uuid
import threading
from collections import OrderedDict
from contextlib import contextmanager
from datetime import datetime
from typing import Optional, List, Dict, Any

from src.config.settings import settings
from src.core.logging import logger
from src.core.security import normalize_user_id, is_default_or_local_user
from src.storage.relational_db import get_db_cursor

DEFAULT_LOCAL_USER = settings.DEFAULT_LOCAL_USER
SQLITE_DB_PATH = settings.CHAT_DB_PATH

# Fast in-memory message cache with thread safety and LRU eviction
_messages_cache: OrderedDict[str, List[Dict[str, Any]]] = OrderedDict()
_cache_lock = threading.Lock()
_MAX_CACHE_SESSIONS = 500
_MAX_MESSAGES_PER_SESSION = 100


def _touch_and_store_in_cache(
    session_id: str,
    new_messages: Optional[List[Dict[str, Any]]] = None,
    append_message: Optional[Dict[str, Any]] = None,
):
    """Internal helper enforcing LRU eviction and per-session message limits under _cache_lock."""
    if session_id in _messages_cache:
        _messages_cache.move_to_end(session_id)
        if append_message is not None:
            _messages_cache[session_id].append(append_message)
            if len(_messages_cache[session_id]) > _MAX_MESSAGES_PER_SESSION:
                _messages_cache[session_id] = _messages_cache[session_id][-_MAX_MESSAGES_PER_SESSION:]
        elif new_messages is not None:
            _messages_cache[session_id] = [dict(m) for m in new_messages[-_MAX_MESSAGES_PER_SESSION:]]
    else:
        while len(_messages_cache) >= _MAX_CACHE_SESSIONS:
            _messages_cache.popitem(last=False)
        if append_message is not None:
            _messages_cache[session_id] = [append_message]
        elif new_messages is not None:
            _messages_cache[session_id] = [dict(m) for m in new_messages[-_MAX_MESSAGES_PER_SESSION:]]
        else:
            _messages_cache[session_id] = []


_chat_db_initialized = False


def init_chat_db():
    """Initializes chat tables in PostgreSQL or SQLite once per process."""
    global _chat_db_initialized
    if _chat_db_initialized:
        return
    _chat_db_initialized = True

    try:
        with get_db_cursor(commit=True) as (conn, cur, p):
            if p == "%s":
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS chat_sessions (
                        session_id UUID PRIMARY KEY,
                        user_id UUID NOT NULL,
                        title TEXT NOT NULL DEFAULT 'New Chat',
                        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                    );
                    CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id ON chat_sessions(user_id);
                    CREATE INDEX IF NOT EXISTS idx_chat_sessions_created_at ON chat_sessions(created_at DESC);
                    CREATE TABLE IF NOT EXISTS chat_messages (
                        message_id UUID PRIMARY KEY,
                        session_id UUID NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
                        role TEXT NOT NULL,
                        content TEXT NOT NULL,
                        contexts_json JSONB,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                    );
                    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);
                    CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at ASC);
                """)
                logger.info("PostgreSQL chat tables verified")
            else:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS sessions (
                        session_id TEXT PRIMARY KEY,
                        title TEXT NOT NULL,
                        user_id TEXT NOT NULL DEFAULT '10d2f529-3fae-4a29-9a5e-312876700ff9',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                """)
                try:
                    cur.execute(f"ALTER TABLE sessions ADD COLUMN user_id TEXT DEFAULT '{DEFAULT_LOCAL_USER}';")
                except Exception:
                    pass
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS messages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        session_id TEXT NOT NULL,
                        role TEXT NOT NULL,
                        content TEXT NOT NULL,
                        contexts_json TEXT,
                        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (session_id) REFERENCES sessions (session_id) ON DELETE CASCADE
                    );
                """)
                cur.execute("CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);")
    except Exception as e:
        logger.error(f"SQLite chat init error: {e}")


def create_session(title: str = "New Chat", user_id: Optional[str] = None, session_id: Optional[str] = None) -> str:
    """Creates a new session record associated with the specified user."""
    init_chat_db()
    sess_id = session_id or str(uuid.uuid4())
    norm_user = normalize_user_id(user_id)
    now = datetime.now()

    try:
        with get_db_cursor(commit=True) as (conn, cur, p):
            sess_tbl = "chat_sessions" if p == "%s" else "sessions"
            ts = now if p == "%s" else now.isoformat()
            cur.execute(
                f"""
                INSERT INTO {sess_tbl} (session_id, user_id, title, created_at)
                VALUES ({p}, {p}, {p}, {p})
                ON CONFLICT (session_id) DO UPDATE SET title = EXCLUDED.title
                """,
                (sess_id, norm_user, title, ts)
            )
            return sess_id
    except Exception as e:
        logger.error(f"create_session error: {e}")

    return sess_id


def get_all_sessions(user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Retrieves all chat sessions strictly belonging to the specified user."""
    init_chat_db()
    norm_user = normalize_user_id(user_id) if user_id else None
    is_local = is_default_or_local_user(user_id)

    try:
        with get_db_cursor() as (conn, cur, p):
            sess_tbl = "chat_sessions" if p == "%s" else "sessions"
            msg_tbl = "chat_messages" if p == "%s" else "messages"

            if norm_user:
                if is_local:
                    query = f"""
                        SELECT s.session_id, s.title, s.created_at, COUNT(m.session_id) as msg_count
                        FROM {sess_tbl} s
                        LEFT JOIN {msg_tbl} m ON s.session_id = m.session_id
                        WHERE s.user_id = {p} OR s.user_id = {p}
                        GROUP BY s.session_id, s.title, s.created_at
                        ORDER BY s.created_at DESC
                    """
                    params = (norm_user, DEFAULT_LOCAL_USER)
                else:
                    query = f"""
                        SELECT s.session_id, s.title, s.created_at, COUNT(m.session_id) as msg_count
                        FROM {sess_tbl} s
                        LEFT JOIN {msg_tbl} m ON s.session_id = m.session_id
                        WHERE s.user_id = {p}
                        GROUP BY s.session_id, s.title, s.created_at
                        ORDER BY s.created_at DESC
                    """
                    params = (norm_user,)
            else:
                query = f"""
                    SELECT s.session_id, s.title, s.created_at, COUNT(m.session_id) as msg_count
                    FROM {sess_tbl} s
                    LEFT JOIN {msg_tbl} m ON s.session_id = m.session_id
                    GROUP BY s.session_id, s.title, s.created_at
                    ORDER BY s.created_at DESC
                """
                params = ()

            cur.execute(query, params)
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
        logger.error(f"get_all_sessions error: {e}")
        return []


def _persist_message_to_db(session_id: str, role: str, content: str, contexts: Optional[List[dict]] = None, user_id: Optional[str] = None):
    message_id = str(uuid.uuid4())
    norm_user = normalize_user_id(user_id)
    contexts_json = json.dumps(contexts) if contexts else None
    now = datetime.now()

    try:
        with get_db_cursor(commit=True) as (conn, cur, p):
            sess_tbl = "chat_sessions" if p == "%s" else "sessions"
            msg_tbl = "chat_messages" if p == "%s" else "messages"
            ts = now if p == "%s" else now.isoformat()

            cur.execute(f"SELECT 1 FROM {sess_tbl} WHERE session_id = {p}", (session_id,))
            if not cur.fetchone():
                short_title = content[:30] + ("..." if len(content) > 30 else "")
                cur.execute(
                    f"INSERT INTO {sess_tbl} (session_id, user_id, title, created_at) VALUES ({p}, {p}, {p}, {p}) ON CONFLICT (session_id) DO NOTHING",
                    (session_id, norm_user, short_title, ts)
                )

            if role == "user":
                cur.execute(f"SELECT COUNT(*) FROM {msg_tbl} WHERE session_id = {p}", (session_id,))
                count = cur.fetchone()[0]
                if count == 0:
                    short_title = content[:30] + ("..." if len(content) > 30 else "")
                    cur.execute(f"UPDATE {sess_tbl} SET title = {p} WHERE session_id = {p}", (short_title, session_id))

            if p == "%s":
                cur.execute(
                    f"INSERT INTO {msg_tbl} (message_id, session_id, role, content, contexts_json, created_at) VALUES ({p}, {p}, {p}, {p}, {p}, {p})",
                    (message_id, session_id, role, content, contexts_json, ts)
                )
            else:
                cur.execute(
                    f"INSERT INTO {msg_tbl} (session_id, role, content, contexts_json, timestamp) VALUES ({p}, {p}, {p}, {p}, {p})",
                    (session_id, role, content, contexts_json, ts)
                )
    except Exception as e:
        logger.error(f"_persist_message_to_db error: {e}")
        raise


def add_message(session_id: str, role: str, content: str, contexts: Optional[List[dict]] = None, user_id: Optional[str] = None):
    """Synchronously appends message to memory cache and database."""
    msg = {"role": role, "content": content, "contexts": contexts}
    with _cache_lock:
        _touch_and_store_in_cache(session_id, append_message=msg)

    _persist_message_to_db(session_id, role, content, contexts, user_id=user_id)


def _safe_persist_worker(session_id: str, role: str, content: str, contexts: Optional[List[dict]], user_id: Optional[str]):
    try:
        logger.info(f"Asynchronously persisting message: session={session_id} role={role}")
        _persist_message_to_db(session_id, role, content, contexts, user_id=user_id)
    except Exception as e:
        logger.error(
            f"Failed to asynchronously persist chat message (session={session_id}, role={role}): {e}",
            exc_info=True,
        )


def save_message_async(session_id: str, role: str, content: str, contexts: Optional[List[dict]] = None, user_id: Optional[str] = None):
    """Updates in-memory cache immediately and persists to DB asynchronously in background thread."""
    msg = {"role": role, "content": content, "contexts": contexts}
    with _cache_lock:
        _touch_and_store_in_cache(session_id, append_message=msg)

    import contextvars
    ctx = contextvars.copy_context()
    threading.Thread(
        target=ctx.run,
        args=(_safe_persist_worker, session_id, role, content, contexts, user_id),
        daemon=True,
        name=f"chat-persist-{session_id[:8]}",
    ).start()


def get_session_messages(session_id: str) -> List[Dict[str, Any]]:
    """Retrieves conversation history for a session."""
    with _cache_lock:
        if session_id in _messages_cache:
            _messages_cache.move_to_end(session_id)
            return [dict(m) for m in _messages_cache[session_id]]

    try:
        with get_db_cursor() as (conn, cur, p):
            msg_tbl = "chat_messages" if p == "%s" else "messages"
            order_col = "created_at" if p == "%s" else "timestamp"
            cur.execute(
                f"SELECT role, content, contexts_json FROM {msg_tbl} WHERE session_id = {p} ORDER BY {order_col} ASC",
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
            with _cache_lock:
                _touch_and_store_in_cache(session_id, new_messages=messages)
            return messages
    except Exception as e:
        logger.error(f"get_session_messages error: {e}")
        return []


def delete_session(session_id: str):
    """Deletes a chat session and its messages."""
    with _cache_lock:
        _messages_cache.pop(session_id, None)

    try:
        with get_db_cursor(commit=True) as (conn, cur, p):
            msg_tbl = "chat_messages" if p == "%s" else "messages"
            sess_tbl = "chat_sessions" if p == "%s" else "sessions"
            cur.execute(f"DELETE FROM {msg_tbl} WHERE session_id = {p}", (session_id,))
            cur.execute(f"DELETE FROM {sess_tbl} WHERE session_id = {p}", (session_id,))
    except Exception as e:
        logger.error(f"delete_session error: {e}")


def delete_user_sessions(user_id: str):
    """Deletes all chat sessions belonging strictly to a specific user."""
    if not user_id:
        return
    with _cache_lock:
        _messages_cache.clear()

    norm_user = normalize_user_id(user_id)
    is_local = is_default_or_local_user(user_id)

    try:
        with get_db_cursor(commit=True) as (conn, cur, p):
            msg_tbl = "chat_messages" if p == "%s" else "messages"
            sess_tbl = "chat_sessions" if p == "%s" else "sessions"
            if is_local:
                cur.execute(
                    f"DELETE FROM {msg_tbl} WHERE session_id IN (SELECT session_id FROM {sess_tbl} WHERE user_id = {p} OR user_id = {p})",
                    (norm_user, DEFAULT_LOCAL_USER)
                )
                cur.execute(f"DELETE FROM {sess_tbl} WHERE user_id = {p} OR user_id = {p}", (norm_user, DEFAULT_LOCAL_USER))
            else:
                cur.execute(
                    f"DELETE FROM {msg_tbl} WHERE session_id IN (SELECT session_id FROM {sess_tbl} WHERE user_id = {p})",
                    (norm_user,)
                )
                cur.execute(f"DELETE FROM {sess_tbl} WHERE user_id = {p}", (norm_user,))
    except Exception as e:
        logger.error(f"delete_user_sessions error: {e}")

