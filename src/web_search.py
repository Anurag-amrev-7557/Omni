import os
import re
import urllib.parse
import urllib.request
import json
from html import unescape
from typing import Generator
from dotenv import load_dotenv

load_dotenv()

def extract_domain(url: str) -> str:
    try:
        parsed = urllib.parse.urlparse(url)
        netloc = parsed.netloc.lower()
        if netloc.startswith("www."):
            netloc = netloc[4:]
        return netloc or "web"
    except Exception:
        return "web"

def search_tavily(query: str, max_results: int = 5) -> list[dict]:
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        return []
    try:
        data = json.dumps({
            "api_key": api_key,
            "query": query,
            "search_depth": "advanced",
            "include_answer": False,
            "max_results": max_results,
        }).encode("utf-8")
        req = urllib.request.Request(
            "https://api.tavily.com/search",
            data=data,
            headers={"Content-Type": "application/json", "User-Agent": "Omni-RAG-Research/2.0"},
        )
        with urllib.request.urlopen(req, timeout=6) as response:
            res_json = json.loads(response.read().decode("utf-8"))
            results = []
            for item in res_json.get("results", []):
                url = item.get("url", "")
                results.append({
                    "title": item.get("title", "Web Page"),
                    "url": url,
                    "domain": extract_domain(url),
                    "snippet": item.get("content", ""),
                    "source_type": "web",
                })
            return results
    except Exception as exc:
        print(f"[Warning] Tavily search fallback error: {exc}")
        return []

def search_duckduckgo(query: str, max_results: int = 5) -> list[dict]:
    """Zero-config real-time DuckDuckGo search parser with robust sanitization."""
    try:
        encoded_q = urllib.parse.quote(query)
        url = f"https://html.duckduckgo.com/html/?q={encoded_q}"
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            },
        )
        with urllib.request.urlopen(req, timeout=6) as response:
            html = response.read().decode("utf-8", errors="ignore")
            
        results = []
        # Parse result blocks from DuckDuckGo HTML
        blocks = re.findall(
            r'<a class="result__url" href="([^"]+)".*?<a class="result__snippet[^>]*>(.*?)</a>',
            html,
            re.DOTALL
        )
        # Also parse titles
        title_blocks = re.findall(
            r'<a class="result__a" href="([^"]+)">(.*?)</a>',
            html,
            re.DOTALL
        )
        
        titles_map = {}
        for href, raw_title in title_blocks:
            clean_title = re.sub(r"<[^>]+>", "", raw_title).strip()
            # DuckDuckGo wraps target URLs in /l/?kh=-1&uddg=...
            target_url = href
            if "uddg=" in href:
                try:
                    target_url = urllib.parse.unquote(href.split("uddg=")[1].split("&")[0])
                except Exception:
                    pass
            titles_map[target_url] = unescape(clean_title)

        for href, raw_snippet in blocks:
            clean_snippet = re.sub(r"<[^>]+>", "", raw_snippet).strip()
            clean_snippet = unescape(clean_snippet)
            target_url = href
            if "uddg=" in href:
                try:
                    target_url = urllib.parse.unquote(href.split("uddg=")[1].split("&")[0])
                except Exception:
                    pass
            
            if not target_url.startswith("http"):
                continue
                
            title = titles_map.get(target_url) or extract_domain(target_url)
            
            if not any(r["url"] == target_url for r in results):
                results.append({
                    "title": title,
                    "url": target_url,
                    "domain": extract_domain(target_url),
                    "snippet": clean_snippet,
                    "source_type": "web",
                })
                if len(results) >= max_results:
                    break
        return results
    except Exception as exc:
        print(f"[Warning] DuckDuckGo search error: {exc}")
        return []

def search_web_knowledge(query: str, max_results: int = 5) -> list[dict]:
    """Production research search: Tries Tavily first if configured, then DuckDuckGo."""
    results = search_tavily(query, max_results)
    if not results:
        results = search_duckduckgo(query, max_results)
    return results

def format_web_contexts_for_prompt(web_results: list[dict], start_idx: int = 1) -> tuple[str, list[dict]]:
    """Formats retrieved web results into LLM context and structured frontend context items."""
    text_blocks = []
    formatted_contexts = []
    
    for i, res in enumerate(web_results, start=start_idx):
        text_blocks.append(
            f"--- WEB SOURCE [{i}]: {res['title']} ({res['domain']}) ---\nURL: {res['url']}\nExcerpt:\n{res['snippet']}\n"
        )
        formatted_contexts.append({
            "filename": f"🌐 {res['title'][:32]}...",
            "title": res["title"],
            "url": res["url"],
            "domain": res["domain"],
            "content": res["snippet"],
            "parent_content": res["snippet"],
            "page": 1,
            "source_type": "web",
        })
        
    return "\n".join(text_blocks), formatted_contexts
