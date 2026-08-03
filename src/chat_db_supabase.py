"""
Supabase PostgreSQL Integration for Chat History

Replaces SQLite with PostgreSQL (via Supabase) for persistent chat storage.
This ensures chat history persists across Render deployments.
"""

import os
import json
import uuid
from datetime import datetime
from typing import Optional, Dict, List
import psycopg2
from psycopg2.extras import RealDictCursor

# Lazy-load database connection
_db_connection = None

def get_db_connection():
    """
    Get or initialize PostgreSQL connection using DATABASE_URL environment variable.
    
    Expected format: postgresql://user:password@host:port/database
    Or Neon: postgresql://user:password@*.neon.tech/database?sslmode=require
    """
    global _db_connection
    
    if _db_connection is not None and not _db_connection.closed:
        return _db_connection
    
    database_url = os.getenv("DATABASE_URL") or os.getenv("NEON_DATABASE_URL", "").strip()
    
    if not database_url:
        raise ValueError(
            "DATABASE_URL or NEON_DATABASE_URL environment variable must be set\n"
            "Example: postgresql://user:password@neon.tech/database?sslmode=require"
        )
    
    try:
        _db_connection = psycopg2.connect(database_url)
        print(f"[ChatDB] ✓ Connected to PostgreSQL")
        return _db_connection
    except Exception as e:
        print(f"[ChatDB] Error connecting to PostgreSQL: {e}")
        raise

def init_chat_db():
    """
    Initialize chat database tables in PostgreSQL.
    
    Creates:
    - sessions: Chat session metadata
    - messages: Individual chat messages
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Create sessions table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS chat_sessions (
                session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                title TEXT NOT NULL DEFAULT 'New Chat',
                user_id TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_user_id (user_id),
                INDEX idx_created_at (created_at)
            )
        """)
        
        # Create messages table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS chat_messages (
                message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                session_id UUID NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                contexts_json JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_session_id (session_id),
                INDEX idx_created_at (created_at)
            )
        """)
        
        conn.commit()
        print("[ChatDB] ✓ Database tables initialized")
    except psycopg2.Error as e:
        print(f"[ChatDB] Database error during init: {e}")
        # Tables might already exist, continue
    except Exception as e:
        print(f"[ChatDB] Error initializing database: {e}")

def create_session(title: str = "New Chat", user_id: str = None) -> str:
    """
    Create a new chat session.
    
    Args:
        title: Session title
        user_id: User ID
    
    Returns:
        Session ID (UUID)
    """
    if not user_id:
        user_id = "default_user"
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        session_id = str(uuid.uuid4())
        
        cursor.execute(
            """
            INSERT INTO chat_sessions (session_id, title, user_id, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING session_id
            """,
            (session_id, title, user_id, datetime.now(), datetime.now())
        )
        
        conn.commit()
        print(f"[ChatDB] ✓ Created session {session_id}")
        return session_id
    
    except Exception as e:
        print(f"[ChatDB] Error creating session: {e}")
        raise

def get_all_sessions(user_id: str = None) -> List[Dict]:
    """
    Get all chat sessions for a user.
    
    Args:
        user_id: Filter by user ID (optional)
    
    Returns:
        List of session objects
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        if user_id:
            cursor.execute(
                """
                SELECT session_id, title, created_at, updated_at
                FROM chat_sessions
                WHERE user_id = %s
                ORDER BY updated_at DESC
                LIMIT 100
                """,
                (user_id,)
            )
        else:
            cursor.execute(
                """
                SELECT session_id, title, created_at, updated_at
                FROM chat_sessions
                ORDER BY updated_at DESC
                LIMIT 1000
                """
            )
        
        sessions = cursor.fetchall()
        return [dict(s) for s in sessions]
    
    except Exception as e:
        print(f"[ChatDB] Error fetching sessions: {e}")
        return []

def add_message(
    session_id: str,
    role: str,
    content: str,
    contexts: List[Dict] = None
) -> str:
    """
    Add a message to a chat session.
    
    Args:
        session_id: Session ID
        role: "user" or "assistant"
        content: Message content
        contexts: Optional context documents (list of dicts)
    
    Returns:
        Message ID (UUID)
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        message_id = str(uuid.uuid4())
        contexts_json = json.dumps(contexts) if contexts else None
        
        # Auto-update session title if first user message
        if role == "user":
            cursor.execute(
                "SELECT COUNT(*) as count FROM chat_messages WHERE session_id = %s",
                (session_id,)
            )
            count = cursor.fetchone()[0]
            
            if count == 0:
                short_title = content[:50] + ("..." if len(content) > 50 else "")
                cursor.execute(
                    "UPDATE chat_sessions SET title = %s, updated_at = %s WHERE session_id = %s",
                    (short_title, datetime.now(), session_id)
                )
        
        # Insert message
        cursor.execute(
            """
            INSERT INTO chat_messages (message_id, session_id, role, content, contexts_json, created_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING message_id
            """,
            (message_id, session_id, role, content, contexts_json, datetime.now())
        )
        
        # Update session's updated_at
        cursor.execute(
            "UPDATE chat_sessions SET updated_at = %s WHERE session_id = %s",
            (datetime.now(), session_id)
        )
        
        conn.commit()
        print(f"[ChatDB] ✓ Added {role} message to session {session_id}")
        return message_id
    
    except Exception as e:
        print(f"[ChatDB] Error adding message: {e}")
        raise

def get_session_messages(session_id: str) -> List[Dict]:
    """
    Get all messages in a chat session.
    
    Args:
        session_id: Session ID
    
    Returns:
        List of message objects (role, content, contexts)
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        cursor.execute(
            """
            SELECT role, content, contexts_json, created_at
            FROM chat_messages
            WHERE session_id = %s
            ORDER BY created_at ASC
            """,
            (session_id,)
        )
        
        rows = cursor.fetchall()
        messages = []
        
        for r in rows:
            msg = {
                "role": r["role"],
                "content": r["content"],
                "timestamp": r["created_at"].isoformat() if r["created_at"] else None
            }
            
            if r["contexts_json"]:
                try:
                    msg["contexts"] = json.loads(r["contexts_json"])
                except Exception:
                    msg["contexts"] = None
            
            messages.append(msg)
        
        return messages
    
    except Exception as e:
        print(f"[ChatDB] Error fetching messages: {e}")
        return []

def delete_session(session_id: str) -> bool:
    """
    Delete a chat session and all its messages.
    
    Args:
        session_id: Session ID
    
    Returns:
        True if successful
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute("DELETE FROM chat_messages WHERE session_id = %s", (session_id,))
        cursor.execute("DELETE FROM chat_sessions WHERE session_id = %s", (session_id,))
        
        conn.commit()
        print(f"[ChatDB] ✓ Deleted session {session_id}")
        return True
    
    except Exception as e:
        print(f"[ChatDB] Error deleting session: {e}")
        return False

def delete_user_sessions(user_id: str) -> bool:
    """
    Delete all sessions and messages for a user.
    
    Args:
        user_id: User ID
    
    Returns:
        True if successful
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Delete messages first (cascade should handle this, but be explicit)
        cursor.execute(
            """
            DELETE FROM chat_messages
            WHERE session_id IN (SELECT session_id FROM chat_sessions WHERE user_id = %s)
            """,
            (user_id,)
        )
        
        cursor.execute("DELETE FROM chat_sessions WHERE user_id = %s", (user_id,))
        
        conn.commit()
        print(f"[ChatDB] ✓ Deleted all sessions for user {user_id}")
        return True
    
    except Exception as e:
        print(f"[ChatDB] Error deleting user sessions: {e}")
        return False

def get_session_info(session_id: str) -> Optional[Dict]:
    """
    Get metadata for a chat session.
    
    Args:
        session_id: Session ID
    
    Returns:
        Session object or None
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        cursor.execute(
            "SELECT session_id, title, user_id, created_at, updated_at FROM chat_sessions WHERE session_id = %s",
            (session_id,)
        )
        
        session = cursor.fetchone()
        return dict(session) if session else None
    
    except Exception as e:
        print(f"[ChatDB] Error fetching session info: {e}")
        return None
