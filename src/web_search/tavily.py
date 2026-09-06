"""Tavily Web Search Integration with HTTP Connection Pooling."""
from typing import Optional, Dict, Any, List
import requests
from requests.adapters import HTTPAdapter

from src.config.settings import settings
from src.core.logging import logger

TAVILY_SEARCH_URL = "https://api.tavily.com/search"
_tavily_session: Optional[requests.Session] = None


def _get_tavily_session() -> requests.Session:
    global _tavily_session
    if _tavily_session is None:
        _tavily_session = requests.Session()
        adapter = HTTPAdapter(pool_connections=5, pool_maxsize=10, max_retries=1)
        _tavily_session.mount("https://", adapter)
        _tavily_session.headers.update({
            "Content-Type": "application/json",
            "User-Agent": "Omni-RAG-WebSearch/2.0"
        })
    return _tavily_session


def search_tavily(
    query: str,
    max_results: Optional[int] = None,
    search_depth: str = "basic",
    include_answer: bool = False,
) -> Dict[str, Any]:
    """Executes high-speed web search using the Tavily Search API."""
    if not settings.WEB_SEARCH_ENABLED:
        return {"success": False, "error": "Web search is disabled via configuration", "query": query, "results": []}

    api_key = settings.TAVILY_API_KEY.strip()
    if not api_key:
        logger.debug("TAVILY_API_KEY is not configured")
        return {
            "success": False,
            "error": "TAVILY_API_KEY is missing",
            "query": query,
            "answer": None,
            "results": []
        }

    limit = max_results or settings.TAVILY_MAX_RESULTS
    payload = {
        "api_key": api_key,
        "query": query,
        "search_depth": search_depth,
        "max_results": limit,
        "include_answer": include_answer
    }

    try:
        session = _get_tavily_session()
        response = session.post(TAVILY_SEARCH_URL, json=payload, timeout=settings.TAVILY_TIMEOUT)
        response.raise_for_status()
        res_json = response.json()

        answer = res_json.get("answer")
        results = res_json.get("results", [])

        clean_results = []
        for r in results:
            clean_results.append({
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "content": r.get("content", ""),
                "score": r.get("score", 0.0)
            })

        return {
            "success": True,
            "query": query,
            "answer": answer,
            "results": clean_results
        }
    except Exception as e:
        logger.warning(f"Failed web search for '{query}': {e}")
        return {
            "success": False,
            "error": str(e),
            "query": query,
            "answer": None,
            "results": []
        }
