"""Session management and guest lifecycle HTTP endpoints."""
import os
import shutil
from typing import Optional
from fastapi import APIRouter, Depends, Body, Query, HTTPException

from src.config.settings import settings
from src.core.logging import logger
from src.core.auth import require_user, set_current_user
from src.core.security import is_guest_user, normalize_user_id
from src.storage.chat_db import (
    create_session,
    get_all_sessions,
    get_session_messages,
    delete_session,
    delete_user_sessions,
)
from src.storage.vector_store import delete_user_vectors
from src.graph import clear_user_graph
from src.storage.file_storage import get_user_uploads_dir

router = APIRouter(tags=["Sessions & Lifecycle"])


@router.get("/api/sessions")
def get_sessions(user_id: str = Depends(require_user)):
    """Lists all active chat sessions belonging to the authenticated user."""
    set_current_user(user_id)
    sessions = get_all_sessions(user_id=user_id)
    return {"sessions": sessions}


@router.post("/api/sessions")
def create_new_session(data: dict = Body(default={}), user_id: str = Depends(require_user)):
    """Creates a new chat session scoped to the authenticated user."""
    set_current_user(user_id)
    title = data.get("title", "New Chat") if isinstance(data, dict) else "New Chat"
    session_id = data.get("session_id") if isinstance(data, dict) else None
    real_id = create_session(title=title, user_id=user_id, session_id=session_id)
    return {"session_id": real_id, "title": title}


@router.get("/api/sessions/{session_id}/messages")
def get_messages(session_id: str):
    """Retrieves conversation message history for a specific session."""
    messages = get_session_messages(session_id)
    return {"messages": messages}


@router.delete("/api/sessions/{session_id}")
def delete_chat_session(session_id: str):
    """Deletes a chat session and associated messages."""
    delete_session(session_id)
    return {"success": True}


@router.post("/api/reset")
def reset_user_workspace(user_id: str = Depends(require_user)):
    """Resets the requesting user's workspace (vectors, graph, chat history) with strict tenant isolation.

    CRITICAL FIX: Scopes cleanup strictly to the requesting user instead of dropping global tables.
    """
    set_current_user(user_id)
    norm_user = normalize_user_id(user_id)

    # Clean vectors strictly belonging to user
    delete_user_vectors(norm_user)

    # Clean graph strictly belonging to user
    try:
        clear_user_graph(user_id=norm_user)
    except Exception as e:
        logger.debug(f"Reset graph notice: {e}")

    # Clean user sessions
    sessions = get_all_sessions(user_id=norm_user)
    for s in sessions:
        delete_session(s["session_id"])

    new_id = create_session("New Chat", user_id=norm_user)
    return {"success": True, "new_session_id": new_id}


def cleanup_guest_session(guest_id: str):
    """Purges all files, vectors, knowledge graph, and chat sessions for an ephemeral guest."""
    if not is_guest_user(guest_id):
        return

    logger.info(f"Cleaning up ephemeral guest session: {guest_id}")
    try:
        delete_user_vectors(guest_id)
    except Exception as e:
        logger.warning(f"Guest vector cleanup notice for {guest_id}: {e}")

    try:
        clear_user_graph(guest_id)
    except Exception as e:
        logger.warning(f"Guest graph cleanup notice for {guest_id}: {e}")

    try:
        delete_user_sessions(guest_id)
    except Exception as e:
        logger.warning(f"Guest session cleanup notice for {guest_id}: {e}")

    try:
        guest_dir = get_user_uploads_dir(guest_id)
        if os.path.exists(guest_dir) and os.path.isdir(guest_dir):
            shutil.rmtree(guest_dir, ignore_errors=True)
            logger.info(f"Removed guest upload directory: {guest_dir}")
    except Exception as e:
        logger.warning(f"Guest directory cleanup notice for {guest_id}: {e}")


@router.post("/api/guest/cleanup")
@router.get("/api/guest/cleanup")
def guest_cleanup_endpoint(guest_id: Optional[str] = Query(None), user_id: str = Depends(require_user)):
    """Called on browser beforeunload or tab close to prune ephemeral guest data."""
    target_id = guest_id or user_id
    if target_id and is_guest_user(target_id):
        cleanup_guest_session(target_id)
        return {"success": True, "cleaned_guest_id": target_id}
    return {"success": False, "message": "Not an ephemeral guest or no guest_id provided"}
