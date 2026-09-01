import sqlite3
import json
import uuid
import os
from src.auth import get_current_user
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "chat_history.db")

def get_db_connection():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_chat_db():
    """Creates sessions and messages tables if they do not exist."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    columns = {row[1] for row in cursor.execute("PRAGMA table_info(sessions)")}
    if "user_id" not in columns:
        cursor.execute("ALTER TABLE sessions ADD COLUMN user_id TEXT")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)")
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            message_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            contexts_json TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES sessions (session_id) ON DELETE CASCADE
        )
    """)
    
    conn.commit()
    conn.close()

def create_session(title: str = "New Chat") -> str:
    session_id = str(uuid.uuid4())
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO sessions (session_id, title, created_at, user_id) VALUES (?, ?, ?, ?)",
        (session_id, title, datetime.now().isoformat(), get_current_user())
    )
    conn.commit()
    conn.close()
    return session_id

def get_all_sessions() -> list[dict]:
    init_chat_db()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT session_id, title, created_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC", (get_current_user(),))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def add_message(session_id: str, role: str, content: str, contexts: list[dict] = None):
    message_id = str(uuid.uuid4())
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT 1 FROM sessions WHERE session_id = ? AND user_id = ?", (session_id, get_current_user()))
    if cursor.fetchone() is None:
        conn.close()
        raise PermissionError("Session not found")
    
    # Auto-update session title if it's the first user question
    if role == "user":
        cursor.execute("SELECT COUNT(*) as count FROM messages WHERE session_id = ?", (session_id,))
        count = cursor.fetchone()["count"]
        if count == 0:
            short_title = content[:30] + ("..." if len(content) > 30 else "")
            cursor.execute("UPDATE sessions SET title = ? WHERE session_id = ?", (short_title, session_id))
            
    contexts_json = json.dumps(contexts) if contexts else None
    cursor.execute(
        "INSERT INTO messages (message_id, session_id, role, content, contexts_json, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
        (message_id, session_id, role, content, contexts_json, datetime.now().isoformat())
    )
    conn.commit()
    conn.close()

def get_session_messages(session_id: str) -> list[dict]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT m.role, m.content, m.contexts_json FROM messages m JOIN sessions s ON s.session_id=m.session_id WHERE m.session_id = ? AND s.user_id = ? ORDER BY m.timestamp ASC", (session_id, get_current_user()))
    rows = cursor.fetchall()
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
    return messages

def delete_session(session_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM messages WHERE session_id IN (SELECT session_id FROM sessions WHERE session_id = ? AND user_id = ?)", (session_id, get_current_user()))
    cursor.execute("DELETE FROM sessions WHERE session_id = ? AND user_id = ?", (session_id, get_current_user()))
    conn.commit()
    conn.close()
