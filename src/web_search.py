import os
import json
import urllib.request
from typing import Optional

try:
    from src.config import TAVILY_API_KEY
except ImportError:
    try:
        from config import TAVILY_API_KEY
    except ImportError:
        TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")

TAVILY_SEARCH_URL = "https://api.tavily.com/search"

def search_tavily(
    query: str, 
    max_results: int = 5, 
    search_depth: str = "basic",
    include_answer: bool = True
) -> dict:
    """
    Executes a web search using the Tavily Search API.
    Returns structured results including AI synthesized quick answer, sources, and snippets.
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
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            TAVILY_SEARCH_URL,
            data=data,
            headers={"Content-Type": "application/json", "User-Agent": "Omni-RAG-WebSearch/1.0"}
        )
        with urllib.request.urlopen(req, timeout=12) as response:
            res_json = json.loads(response.read().decode("utf-8"))
            
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
