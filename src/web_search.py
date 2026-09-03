import os
import json
from typing import Optional
import requests
from requests.adapters import HTTPAdapter

try:
    from src.config import TAVILY_API_KEY
except ImportError:
    try:
        from config import TAVILY_API_KEY
    except ImportError:
        TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")

TAVILY_SEARCH_URL = "https://api.tavily.com/search"

# Persistent connection pool for Tavily to eliminate SSL handshake overhead on repeated queries
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
    max_results: int = 4, 
    search_depth: str = "basic",
    include_answer: bool = False
) -> dict:
    """
    Executes an ultra-fast web search using the Tavily Search API.
    Uses connection pooling and skips internal LLM answer synthesis for maximum speed (<500ms).
    """
    api_key = TAVILY_API_KEY or os.getenv("TAVILY_API_KEY", "")
    if not api_key:
        print("[Tavily] TAVILY_API_KEY is not configured in .env")
        return {
            "success": False,
            "error": "TAVILY_API_KEY is missing",
            "query": query,
            "answer": None,
            "results": []
        }

    payload = {
        "api_key": api_key,
        "query": query,
        "search_depth": search_depth,
        "max_results": max_results,
        "include_answer": include_answer
    }

    try:
        session = _get_tavily_session()
        response = session.post(TAVILY_SEARCH_URL, json=payload, timeout=6.0)
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
        print(f"[Tavily Error] Failed web search for '{query}': {e}")
        return {
            "success": False,
            "error": str(e),
            "query": query,
            "answer": None,
            "results": []
        }

