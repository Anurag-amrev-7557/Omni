"""Conversational RAG Generation Service with Agentic Query Routing and Streaming."""
import concurrent.futures
from functools import lru_cache
import re
from typing import Any, Dict, Generator, List, Optional, Tuple

from src.config.settings import settings
from src.core.logging import logger
from src.core.security import normalize_user_id
from src.generation.llm import invoke_groq_with_fallback, stream_groq_with_fallback
from src.generation.prompts import (
    CONVERSATIONAL_GREETING_PROMPT,
    GROUNDING_RAG_PROMPT,
    VAULT_EMPTY_PROMPT,
    VAULT_INVENTORY_PROMPT,
)
from src.retrieval.service import hybrid_search
from src.storage.vector_store import get_collection_stats
from src.web_search.tavily import search_tavily

_SENTINEL = object()
_NO_CONTEXT_MSG = "I couldn't find any relevant information in the database to answer that."

_VAULT_META_PATTERNS = (
    "what are the docs", "what docs", "which docs", "what files", "which files",
    "list docs", "list the docs", "list files", "list the files",
    "in our knowledge vault", "in the knowledge vault", "in the vault",
    "in our vault", "what documents", "available documents", "uploaded documents",
    "documents in the vault", "files in the vault", "knowledge vault contents",
    "what do we have", "what documents do we have", "what is in the vault",
)
_GREETINGS = frozenset({
    "hi", "hello", "hey", "greetings", "good morning", "good afternoon",
    "good evening", "howdy", "sup", "yo", "what's up", "whats up",
    "how are you", "who are you", "what are you", "help", "thanks", "thank you",
})
_GREETING_PREFIXES = frozenset({"hi", "hello", "hey", "howdy", "greetings"})
_AGGREGATION_MARKERS = (
    "what are the", "list all", "what are all", "summarize all", "all the",
    "projects", "experience", "work", "skills", "overview", "technologies",
)

_DECOMPOSE_RE = re.compile(r"\s+(?:vs\.?|versus|compare)\s+", re.IGNORECASE)
_CLEAN_QUERY_RE = re.compile(r"[^\w\s]")


def reformulate_query(query: str, chat_history: Optional[List[Dict[str, Any]]] = None) -> str:
    """Conversational Memory Router: Preserves query intent for grounding."""
    return query


@lru_cache(maxsize=256)
def decompose_query(query: str) -> List[str]:
    """Agentic Query Decomposer: Fast regex-based split for compound inquiries."""
    parts = _DECOMPOSE_RE.split(query)
    cleaned = [p.strip() for p in parts if p.strip()]
    return cleaned if len(cleaned) > 1 else [query]


def is_vault_meta_query(q: str) -> bool:
    """Detects if the user query is asking for an inventory of documents in the Knowledge Vault."""
    q_lower = q.lower().strip()
    return any(p in q_lower for p in _VAULT_META_PATTERNS)


def is_conversational_query(q: str) -> bool:
    """Detects conversational greetings, introductions, and pleasantries."""
    q_clean = _CLEAN_QUERY_RE.sub("", q.lower()).strip()
    if q_clean in _GREETINGS:
        return True
    words = q_clean.split()
    return bool(words and len(words) <= 4 and words[0] in _GREETING_PREFIXES)


def prepare_context_and_prompt(
    query: str,
    chat_history: Optional[List[Dict[str, Any]]] = None,
    user_id: Optional[str] = None,
    custom_instructions: Optional[str] = None,
    web_search: bool = False,
) -> Tuple[Optional[str], List[Dict[str, Any]]]:
    """Prepares grounding context, performs user-scoped hybrid and web search, and formats prompt."""
    norm_uid = normalize_user_id(user_id)
    logger.info(f"Preparing context and prompt for query='{query[:50]}' user_id={norm_uid}")

    stats = get_collection_stats(user_id=norm_uid)
    active_files = stats.get("files", [])

    manifest_text = "DOCUMENTS CURRENTLY IN THE KNOWLEDGE VAULT:\n" + (
        "".join(f"- {f}\n" for f in active_files) if active_files else "(No documents currently indexed in the vault)\n"
    )
    instructions_clause = (
        f"\n    USER PREFERENCES & SPECIAL INSTRUCTIONS:\n    {custom_instructions.strip()}\n"
        if custom_instructions and custom_instructions.strip() else ""
    )

    template = (
        CONVERSATIONAL_GREETING_PROMPT if is_conversational_query(query)
        else VAULT_INVENTORY_PROMPT if is_vault_meta_query(query)
        else VAULT_EMPTY_PROMPT if not active_files and not web_search
        else None
    )
    if template:
        return template.format(manifest_text=manifest_text, instructions_clause=instructions_clause, query=query), []

    standalone_query = reformulate_query(query, chat_history)
    sub_queries = decompose_query(standalone_query)
    search_queries = list(sub_queries)

    q_lower = query.lower()
    is_aggregation = any(marker in q_lower for marker in _AGGREGATION_MARKERS)
    retrieval_k = 8 if is_aggregation else settings.DEFAULT_RETRIEVAL_K

    def fetch_local_contexts() -> List[Dict[str, Any]]:
        if not active_files:
            return []
        if len(search_queries) <= 1:
            return hybrid_search(search_queries[0], k=retrieval_k, user_id=norm_uid, active_filenames=active_files) if search_queries else []
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(4, len(search_queries))) as ex:
            futs = [ex.submit(hybrid_search, sq, k=retrieval_k, user_id=norm_uid, active_filenames=active_files) for sq in search_queries]
            local_ctx = []
            for f in futs:
                local_ctx.extend(f.result())
            return local_ctx

    def fetch_web_contexts() -> List[Dict[str, Any]]:
        if not web_search:
            return []
        if not settings.TAVILY_API_KEY.strip():
            logger.warning("Live web search was requested, but TAVILY_API_KEY is not configured in .env.")
            return []
        w_ctx = []
        try:
            logger.info(f"Invoking fast Tavily web search for: '{standalone_query}'")
            tavily_res = search_tavily(standalone_query, max_results=settings.TAVILY_MAX_RESULTS, include_answer=False)
            if tavily_res.get("success"):
                if tavily_res.get("answer"):
                    w_ctx.append({
                        "filename": "Tavily AI Web Synthesis",
                        "page": 1,
                        "content": tavily_res["answer"],
                        "url": "https://tavily.com",
                        "is_web": True,
                    })
                for r in tavily_res.get("results", []):
                    snippet = r.get("content", "")
                    if snippet:
                        title = r.get("title") or "Web Source"
                        url = r.get("url", "")
                        w_ctx.append({
                            "filename": f"[Web] {title}",
                            "page": 1,
                            "content": f"{snippet}\nSource URL: {url}",
                            "url": url,
                            "is_web": True,
                        })
            else:
                logger.warning(f"Tavily search failed: {tavily_res.get('error')}")
        except Exception as e:
            logger.warning(f"Tavily search error: {e}")
        return w_ctx

    if web_search and active_files:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            fut_local = executor.submit(fetch_local_contexts)
            fut_web = executor.submit(fetch_web_contexts)
            combined_raw_contexts = fut_local.result() + fut_web.result()
    elif web_search:
        combined_raw_contexts = fetch_web_contexts()
    else:
        combined_raw_contexts = fetch_local_contexts()

    if not combined_raw_contexts:
        if not active_files:
            extra_instructions = instructions_clause
            if web_search and not settings.TAVILY_API_KEY.strip():
                extra_instructions += "\n    NOTE: The user enabled Live Web Search, but TAVILY_API_KEY is not configured in the .env file. Mention this clearly to the user so they know how to enable live web search."
            return VAULT_EMPTY_PROMPT.format(manifest_text=manifest_text, instructions_clause=extra_instructions, query=query), []
        if web_search and not settings.TAVILY_API_KEY.strip():
            extra_instructions = (
                instructions_clause
                + "\n    NOTE: No matching vault documents were found, and Live Web Search was enabled but TAVILY_API_KEY is not configured in .env. Remind the user to configure TAVILY_API_KEY in .env, and answer the query using general knowledge."
            )
            return VAULT_EMPTY_PROMPT.format(manifest_text=manifest_text, instructions_clause=extra_instructions, query=query), []
        return None, []

    seen = set()
    unique_contexts = []
    for ctx in combined_raw_contexts:
        c_text = ctx.get("content", "")
        if c_text not in seen:
            seen.add(c_text)
            unique_contexts.append(ctx)

    context_blocks = []
    for idx, ctx in enumerate(unique_contexts, start=1):
        page_info = f", Page {ctx['page']}" if ctx.get("page") and not ctx.get("is_web") else ""
        context_blocks.append(f"--- SOURCE [{idx}]: {ctx['filename']}{page_info} ---\n{ctx['content']}\n\n")
    combined_context = "".join(context_blocks)

    prompt = GROUNDING_RAG_PROMPT.format(
        instructions_clause=instructions_clause,
        manifest_text=manifest_text,
        combined_context=combined_context,
        query=query,
    )
    return prompt, unique_contexts


def answer_query_stream(
    query: str,
    chat_history: Optional[List[Dict[str, Any]]] = None,
    model: Optional[str] = None,
    prepared_prompt: Any = _SENTINEL,
    user_id: Optional[str] = None,
) -> Generator[str, None, None]:
    """Streams answer tokens chunk-by-chunk with automatic fallback across Groq models."""
    prompt = prepared_prompt if prepared_prompt is not _SENTINEL else prepare_context_and_prompt(query, chat_history, user_id=user_id)[0]
    if not prompt:
        yield _NO_CONTEXT_MSG
        return

    logger.info(f"Streaming LLM answer tokens with fallback for model={model or settings.PRIMARY_LLM_MODEL}")
    yield from stream_groq_with_fallback(
        prompt=prompt,
        model=model,
        max_tokens=settings.LLM_MAX_TOKENS,
        temperature=0.0,
    )


def answer_query(
    query: str,
    chat_history: Optional[List[Dict[str, Any]]] = None,
    model: Optional[str] = None,
    user_id: Optional[str] = None,
    prepared_prompt: Any = _SENTINEL,
) -> str:
    """Synchronous fallback answer generation with multi-model failover."""
    prompt = prepared_prompt if prepared_prompt is not _SENTINEL else prepare_context_and_prompt(query, chat_history, user_id=user_id)[0]
    if not prompt:
        return _NO_CONTEXT_MSG

    response = invoke_groq_with_fallback(
        prompt=prompt,
        max_tokens=settings.LLM_MAX_TOKENS,
        temperature=0.0,
    )
    return response or "I couldn't generate an answer due to an upstream LLM connection issue."
