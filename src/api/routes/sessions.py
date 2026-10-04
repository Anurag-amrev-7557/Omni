import os
import shutil
from typing import Optional
from fastapi import APIRouter, Depends, Body, Query

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


def purge_user_data(user_id: str, purge_uploads: bool = False):
    """Purges user data (vectors, graph, chat sessions) with tenant isolation."""
    norm_user = normalize_user_id(user_id)
    try:
        delete_user_vectors(norm_user)
    except Exception as e:
        logger.debug(f"User vector cleanup notice for {norm_user}: {e}")

    try:
        clear_user_graph(user_id=norm_user)
    except Exception as e:
        logger.debug(f"User graph cleanup notice for {norm_user}: {e}")

    try:
        delete_user_sessions(norm_user)
    except Exception as e:
        logger.debug(f"User session cleanup notice for {norm_user}: {e}")

    if purge_uploads:
        try:
            target_dir = get_user_uploads_dir(user_id)
            if os.path.exists(target_dir) and os.path.isdir(target_dir):
                shutil.rmtree(target_dir, ignore_errors=True)
                logger.info(f"Removed upload directory: {target_dir}")
        except Exception as e:
            logger.warning(f"Upload directory cleanup notice for {user_id}: {e}")


@router.post("/api/reset")
def reset_user_workspace(user_id: str = Depends(require_user)):
    """Resets the requesting user's workspace (vectors, graph, chat history) with strict tenant isolation."""
    set_current_user(user_id)
    norm_user = normalize_user_id(user_id)
    purge_user_data(norm_user, purge_uploads=False)
    new_id = create_session("New Chat", user_id=norm_user)
    return {"success": True, "new_session_id": new_id}


def cleanup_guest_session(guest_id: str):
    """Purges all files, vectors, knowledge graph, and chat sessions for an ephemeral guest."""
    if not is_guest_user(guest_id):
        return
    logger.info(f"Cleaning up ephemeral guest session: {guest_id}")
    purge_user_data(guest_id, purge_uploads=True)


@router.post("/api/guest/cleanup")
@router.get("/api/guest/cleanup")
def guest_cleanup_endpoint(guest_id: Optional[str] = Query(None), user_id: str = Depends(require_user)):
    """Called on browser beforeunload or tab close to prune ephemeral guest data."""
    target_id = guest_id or user_id
    if target_id and is_guest_user(target_id):
        cleanup_guest_session(target_id)
        return {"success": True, "cleaned_guest_id": target_id}
    return {"success": False, "message": "Not an ephemeral guest or no guest_id provided"}
