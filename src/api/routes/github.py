"""GitHub repository connector endpoints for ingesting remote source code and markdown."""
import json
import asyncio
from typing import Optional, List
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from src.core.auth import require_user, set_current_user
from src.github.client import parse_github_repo_url, fetch_repo_tree
from src.github.sync import sync_github_files, sync_github_files_stream

router = APIRouter(tags=["GitHub Connector"])


class GitHubPreviewRequest(BaseModel):
    repo: Optional[str] = None
    repo_url: Optional[str] = None
    branch: Optional[str] = None
    token: Optional[str] = None
    subfolder: Optional[str] = None
    extensions: Optional[List[str]] = None


class GitHubSyncRequest(BaseModel):
    repo: Optional[str] = None
    repo_url: Optional[str] = None
    branch: Optional[str] = None
    token: Optional[str] = None
    files: Optional[List[str]] = None
    selected_paths: Optional[List[str]] = None
    subfolder: Optional[str] = None
    extensions: Optional[List[str]] = None


@router.post("/api/github/preview")
def preview_github_repo(req: GitHubPreviewRequest, user_id: str = Depends(require_user)):
    """Previews repository file tree and detects ingestible code and markdown files."""
    set_current_user(user_id)
    repo_input = (req.repo or req.repo_url or "").strip()
    if not repo_input:
        raise HTTPException(status_code=400, detail="Repository URL or 'owner/repo' is required.")

    try:
        owner, repo = parse_github_repo_url(repo_input)
        tree_info = fetch_repo_tree(
            owner=owner,
            repo=repo,
            branch=req.branch,
            token=req.token,
            subfolder=req.subfolder,
            extensions=req.extensions,
            max_files=150,
        )
        return tree_info
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/github/sync")
def sync_github_repo(req: GitHubSyncRequest, user_id: str = Depends(require_user)):
    """Synchronously fetches and ingests selected GitHub files into the Knowledge Vault."""
    set_current_user(user_id)
    repo_input = (req.repo or req.repo_url or "").strip()
    if not repo_input:
        raise HTTPException(status_code=400, detail="Repository URL or 'owner/repo' is required.")

    selected = req.files or req.selected_paths

    try:
        owner, repo = parse_github_repo_url(repo_input)
        result = sync_github_files(
            owner=owner,
            repo=repo,
            branch=req.branch or "main",
            selected_paths=selected,
            token=req.token,
            subfolder=req.subfolder,
            extensions=req.extensions,
            user_id=user_id,
            max_files=150,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/github/sync-stream")
async def sync_github_stream(data: dict, user_id: str = Depends(require_user)):
    """Streams live ingestion progress events while downloading and vectorizing GitHub files."""
    set_current_user(user_id)
    repo_input = (data.get("repo") or data.get("repo_url") or "").strip()
    branch = (data.get("branch") or "").strip() or "main"
    token = (data.get("token") or "").strip() or None
    selected_files = data.get("files") or data.get("selected_paths")
    subfolder = (data.get("subfolder") or "").strip() or None
    extensions = data.get("extensions")

    if not repo_input:
        raise HTTPException(status_code=400, detail="Repository URL or 'owner/repo' is required.")

    try:
        owner, repo = parse_github_repo_url(repo_input)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    async def event_generator():
        loop = asyncio.get_running_loop()
        gen = sync_github_files_stream(
            owner=owner,
            repo=repo,
            branch=branch,
            selected_paths=selected_files,
            token=token,
            subfolder=subfolder,
            extensions=extensions,
            user_id=user_id,
            max_files=150,
        )

        def _get_next():
            try:
                return next(gen), False
            except StopIteration:
                return None, True

        while True:
            try:
                item, is_done = await loop.run_in_executor(None, _get_next)
                if is_done:
                    break
                yield json.dumps(item) + "\n"
            except Exception as loop_err:
                yield json.dumps({"type": "error", "error": str(loop_err)}) + "\n"
                break

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")
