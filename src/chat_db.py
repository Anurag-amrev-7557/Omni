import sqlite3
import json
import uuid
import os
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
        "INSERT INTO sessions (session_id, title, created_at) VALUES (?, ?, ?)",
        (session_id, title, datetime.now().isoformat())
    )
    conn.commit()
    conn.close()
    return session_id

def get_all_sessions() -> list[dict]:
    init_chat_db()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT session_id, title, created_at FROM sessions ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def add_message(session_id: str, role: str, content: str, contexts: list[dict] = None):
    message_id = str(uuid.uuid4())
    conn = get_db_connection()
    cursor = conn.cursor()
    
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
    cursor.execute("SELECT role, content, contexts_json FROM messages WHERE session_id = ? ORDER BY timestamp ASC", (session_id,))
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
    cursor.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
    cursor.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
    conn.commit()
    conn.close()
