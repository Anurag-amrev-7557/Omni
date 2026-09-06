"""GitHub Repository Synchronization and Ingestion Orchestrator."""
import os
from typing import Optional, List

from src.config.settings import settings
from src.core.logging import logger
from src.github.client import fetch_repo_tree, fetch_raw_file_content
from src.ingestion.service import ingest_file


def sync_github_files(
    owner: str,
    repo: str,
    branch: str = "main",
    selected_paths: Optional[List[str]] = None,
    token: Optional[str] = None,
    subfolder: Optional[str] = None,
    extensions: Optional[List[str]] = None,
    user_id: Optional[str] = None,
    max_files: int = 150,
) -> dict:
    """Downloads selected or matched repository files and ingests them into the Knowledge Vault."""
    if not selected_paths:
        tree = fetch_repo_tree(
            owner=owner,
            repo=repo,
            branch=branch,
            token=token,
            subfolder=subfolder,
            extensions=extensions,
            max_files=max_files,
        )
        selected_paths = [f["path"] for f in tree.get("files", [])]

    if not selected_paths:
        return {"success": False, "message": "No matching files found to ingest.", "ingested_count": 0}

    for item in sync_github_files_stream(
        owner=owner,
        repo=repo,
        branch=branch,
        selected_paths=selected_paths,
        token=token,
        subfolder=subfolder,
        extensions=extensions,
        user_id=user_id,
        max_files=max_files,
    ):
        if item.get("type") == "done":
            return item
    return {"success": False, "message": "Failed to complete synchronization.", "ingested_count": 0}


def sync_github_files_stream(
    owner: str,
    repo: str,
    branch: str = "main",
    selected_paths: Optional[List[str]] = None,
    token: Optional[str] = None,
    subfolder: Optional[str] = None,
    extensions: Optional[List[str]] = None,
    user_id: Optional[str] = None,
    max_files: int = 150,
):
    """Generator that downloads and ingests repository files into the Knowledge Vault,
    yielding structured progress events in real-time as each file finishes.
    """
    if not selected_paths:
        tree = fetch_repo_tree(
            owner=owner,
            repo=repo,
            branch=branch,
            token=token,
            subfolder=subfolder,
            extensions=extensions,
            max_files=max_files,
        )
        selected_paths = [f["path"] for f in tree.get("files", [])]

    if not selected_paths:
        yield {
            "type": "done",
            "success": False,
            "message": "No matching files found to ingest.",
            "ingested_count": 0,
            "failed_count": 0,
            "ingested_files": [],
            "failed_files": [],
        }
        return

    paths_to_ingest = selected_paths[:max_files]
    total = len(paths_to_ingest)

    base_target_dir = os.path.abspath(os.path.join(settings.UPLOADS_DIR, f"github_{owner}_{repo}"))
    os.makedirs(base_target_dir, exist_ok=True)

    yield {
        "type": "start",
        "owner": owner,
        "repo": repo,
        "branch": branch,
        "total": total,
    }

    ingested = []
    failed = []

    for idx, rel_path in enumerate(paths_to_ingest):
        try:
            content = fetch_raw_file_content(owner, repo, rel_path, branch=branch, token=token)
            flat_filename = f"{owner}_{repo}_{rel_path.replace('/', '_')}"
            local_file_path = os.path.join(base_target_dir, flat_filename)

            with open(local_file_path, "w", encoding="utf-8") as f:
                f.write(content)

            # Vector ingestion into Qdrant
            ingest_file(local_file_path, user_id=user_id, extract_graph=False, generate_ai_summary=False)

            size_mb = round(os.path.getsize(local_file_path) / (1024 * 1024), 2)
            file_entry = {
                "path": rel_path,
                "filename": flat_filename,
                "size_mb": size_mb,
                "size_bytes": len(content),
            }
            ingested.append(file_entry)
            logger.info(f"GitHub Ingested {rel_path} ({flat_filename}) for user {user_id}")

            yield {
                "type": "progress",
                "current": idx + 1,
                "total": total,
                "path": rel_path,
                "filename": flat_filename,
                "size_mb": size_mb,
                "status": "success",
            }
        except Exception as e:
            err_str = str(e)
            logger.warning(f"GitHub Ingestion Error for {rel_path}: {err_str}")
            failed.append({"path": rel_path, "error": err_str})
            yield {
                "type": "progress",
                "current": idx + 1,
                "total": total,
                "path": rel_path,
                "error": err_str,
                "status": "error",
            }

    yield {
        "type": "done",
        "success": len(ingested) > 0,
        "owner": owner,
        "repo": repo,
        "branch": branch,
        "ingested_count": len(ingested),
        "failed_count": len(failed),
        "ingested_files": ingested,
        "failed_files": failed,
    }
