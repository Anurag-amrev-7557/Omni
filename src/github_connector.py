"""
GitHub Repository Connector for Omni RAG.
Fetches repository trees and file contents via GitHub REST API v3 for ingestion into the Knowledge Vault.
"""

import os
import re
import json
import ssl
import urllib.request
import urllib.error
from typing import Optional, List, Dict, Tuple

# Default supported extensions for code and documents
SUPPORTED_EXTENSIONS = {
    # Documents
    ".md", ".markdown", ".txt", ".rst", ".pdf",
    # Programming Languages & Code
    ".py", ".ts", ".tsx", ".js", ".jsx", ".json",
    ".yaml", ".yml", ".go", ".rs", ".java", ".cpp",
    ".c", ".h", ".hpp", ".sql", ".sh", ".bash",
    ".css", ".scss", ".html", ".xml", ".toml"
}

# Directories and files to automatically ignore
IGNORED_PATTERNS = {
    ".git", ".github", "node_modules", "dist", "build",
    "target", ".venv", "venv", "__pycache__", ".next",
    ".idea", ".vscode", "coverage", "vendor",
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock"
}


def parse_github_repo_url(repo_input: str) -> Tuple[str, str]:
    """
    Parses a repository URL or shorthand into (owner, repo).
    Supports:
      - 'owner/repo'
      - 'https://github.com/owner/repo'
      - 'https://github.com/owner/repo.git'
      - 'github.com/owner/repo'
    """
    cleaned = repo_input.strip()
    cleaned = re.sub(r"^https?://", "", cleaned)
    cleaned = re.sub(r"^github\.com/", "", cleaned)
    cleaned = re.sub(r"\.git$", "", cleaned)
    cleaned = cleaned.strip("/")

    parts = cleaned.split("/")
    if len(parts) >= 2:
        owner, repo = parts[0], parts[1]
        return owner.strip(), repo.strip()
    
    raise ValueError(f"Invalid GitHub repository identifier '{repo_input}'. Expected 'owner/repo' or 'https://github.com/owner/repo'.")


def _get_ssl_context():
    """Builds a secure SSL context using certifi if available, with unverified fallback for local macOS environments."""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        pass
    try:
        return ssl.create_default_context()
    except Exception:
        return ssl._create_unverified_context()


def _make_github_request(url: str, token: Optional[str] = None) -> dict:
    """Executes a GET request against the GitHub REST API with optional Bearer token authentication."""
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "Omni-RAG-Connector/2.0",
    }
    if token and token.strip():
        t = token.strip()
        auth_header = t if t.startswith(("Bearer ", "token ")) else f"Bearer {t}"
        headers["Authorization"] = auth_header

    req = urllib.request.Request(url, headers=headers)
    ctx = _get_ssl_context()
    try:
        try:
            with urllib.request.urlopen(req, context=ctx, timeout=20.0) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, ssl.SSLCertVerificationError) as ssl_err:
            if "CERTIFICATE_VERIFY_FAILED" in str(ssl_err):
                # Fallback to unverified context if local certificates are not installed on host machine
                unverified_ctx = ssl._create_unverified_context()
                with urllib.request.urlopen(req, context=unverified_ctx, timeout=20.0) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            raise
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8", errors="ignore")
        try:
            err_json = json.loads(err_msg)
            message = err_json.get("message", err_msg)
        except Exception:
            message = err_msg or str(e)
            
        if e.code == 404:
            raise ValueError("GitHub repository or branch not found. Verify repository name and permissions.")
        elif e.code == 403 and "rate limit" in message.lower():
            raise ValueError("GitHub API rate limit exceeded. Provide a GitHub Personal Access Token (PAT) for 5,000 req/hr.")
        elif e.code == 401:
            raise ValueError("GitHub authentication failed. Check your Personal Access Token (PAT).")
        raise ValueError(f"GitHub API error ({e.code}): {message}")
    except Exception as e:
        raise ValueError(f"Network error communicating with GitHub: {e}")


def get_repo_details(owner: str, repo: str, token: Optional[str] = None) -> dict:
    """Fetches high-level metadata for a repository including default branch and description."""
    url = f"https://api.github.com/repos/{owner}/{repo}"
    return _make_github_request(url, token=token)


def fetch_repo_tree(
    owner: str,
    repo: str,
    branch: Optional[str] = None,
    token: Optional[str] = None,
    subfolder: Optional[str] = None,
    extensions: Optional[List[str]] = None,
    max_files: int = 150,
) -> dict:
    """
    Fetches the recursive file tree of a GitHub repository and filters for ingestible files.
    """
    # 1. Resolve default branch if not provided
    if not branch or not branch.strip():
        repo_info = get_repo_details(owner, repo, token=token)
        branch = repo_info.get("default_branch", "main")

    branch = branch.strip()

    # 2. Query GitHub recursive git tree API (one single request for whole tree)
    tree_url = f"https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1"
    tree_data = _make_github_request(tree_url, token=token)
    
    raw_tree = tree_data.get("tree", [])
    truncated = tree_data.get("truncated", False)

    allowed_exts = set(e.lower() if e.startswith(".") else f".{e.lower()}" for e in extensions) if extensions else SUPPORTED_EXTENSIONS

    subfolder_clean = subfolder.strip().strip("/") if subfolder else None

    matched_files = []
    total_blobs = 0

    for item in raw_tree:
        if item.get("type") != "blob":
            continue

        total_blobs += 1
        path = item.get("path", "")
        size = item.get("size", 0)

        # Ignore non-matching paths
        path_parts = path.split("/")
        if any(part in IGNORED_PATTERNS for part in path_parts):
            continue

        # Subfolder filter
        if subfolder_clean and not path.startswith(subfolder_clean + "/") and path != subfolder_clean:
            continue

        # Extension filter
        _, ext = os.path.splitext(path)
        ext_lower = ext.lower()
        if ext_lower not in allowed_exts:
            continue

        # Skip files that are unusually large for RAG text extraction (> 3MB)
        if size > 3 * 1024 * 1024:
            continue

        matched_files.append({
            "path": path,
            "filename": os.path.basename(path),
            "size": size,
            "size_kb": round(size / 1024, 1),
            "ext": ext_lower.lstrip("."),
            "sha": item.get("sha"),
            "url": f"https://github.com/{owner}/{repo}/blob/{branch}/{path}",
        })

    return {
        "owner": owner,
        "repo": repo,
        "branch": branch,
        "total_blobs": total_blobs,
        "matched_count": len(matched_files),
        "truncated": truncated,
        "files": matched_files[:max_files],
    }


def fetch_raw_file_content(
    owner: str,
    repo: str,
    path: str,
    branch: str = "main",
    token: Optional[str] = None
) -> str:
    """Fetches raw text content of a single file from GitHub."""
    headers = {
        "User-Agent": "Omni-RAG-Connector/2.0",
    }
    if token and token.strip():
        t = token.strip()
        auth_header = t if t.startswith(("Bearer ", "token ")) else f"Bearer {t}"
        headers["Authorization"] = auth_header
        api_url = f"https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref={branch}"
        headers["Accept"] = "application/vnd.github.v3.raw"
        req = urllib.request.Request(api_url, headers=headers)
    else:
        raw_url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}"
        req = urllib.request.Request(raw_url, headers=headers)

    ctx = _get_ssl_context()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=20.0) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, ssl.SSLCertVerificationError) as ssl_err:
        if "CERTIFICATE_VERIFY_FAILED" in str(ssl_err):
            unverified_ctx = ssl._create_unverified_context()
            with urllib.request.urlopen(req, context=unverified_ctx, timeout=20.0) as resp:
                return resp.read().decode("utf-8", errors="replace")
        raise


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
    """
    Downloads selected or matched repository files and ingests them into the Knowledge Vault.
    """
    from src.ingest import ingest_file

    # 1. If paths not explicitly provided, fetch candidate tree
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

    # Restrict batch size to prevent timeout
    paths_to_ingest = selected_paths[:max_files]

    # Target directory for temporary storage
    base_target_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "uploaded_docs", f"github_{owner}_{repo}"))
    os.makedirs(base_target_dir, exist_ok=True)

    ingested = []
    failed = []

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
    """
    Generator that downloads and ingests repository files into the Knowledge Vault,
    yielding structured progress events in real-time as each file finishes.
    """
    from src.ingest import ingest_file

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

    base_target_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "uploaded_docs", f"github_{owner}_{repo}"))
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

            # Fast vector ingestion into Qdrant
            ingest_file(local_file_path, user_id=user_id, extract_graph=False, generate_ai_summary=False)
            
            size_mb = round(os.path.getsize(local_file_path) / (1024 * 1024), 2)
            file_entry = {
                "path": rel_path,
                "filename": flat_filename,
                "size_mb": size_mb,
                "size_bytes": len(content),
            }
            ingested.append(file_entry)
            print(f"[GitHub Connector] Ingested {rel_path} ({flat_filename}) for user {user_id}")

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
            print(f"[GitHub Connector Error] Failed to ingest {rel_path}: {err_str}")
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
