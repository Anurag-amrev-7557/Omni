"""GitHub Connector package for Omni RAG."""
from src.github.client import (
    parse_github_repo_url,
    get_repo_details,
    fetch_repo_tree,
    fetch_raw_file_content,
    IGNORED_PATTERNS,
)
from src.github.sync import (
    sync_github_files,
    sync_github_files_stream,
)

__all__ = [
    "parse_github_repo_url",
    "get_repo_details",
    "fetch_repo_tree",
    "fetch_raw_file_content",
    "IGNORED_PATTERNS",
    "sync_github_files",
    "sync_github_files_stream",
]
