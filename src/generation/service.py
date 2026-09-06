"""Conversational RAG Generation Service with Agentic Query Routing and Streaming."""
import re
from functools import lru_cache
from typing import Generator, List, Dict, Any, Tuple, Optional
import concurrent.futures

from src.config.settings import settings
from src.core.logging import logger
from src.core.security import normalize_user_id
from src.storage.vector_store import get_collection_stats
from src.retrieval.service import hybrid_search
from src.web_search.tavily import search_tavily
from src.generation.prompts import (
    GROUNDING_RAG_PROMPT,
    VAULT_INVENTORY_PROMPT,
    CONVERSATIONAL_GREETING_PROMPT,
    VAULT_EMPTY_PROMPT,
    QUERY_REFORMULATION_PROMPT,
    QUERY_DECOMPOSITION_PROMPT,
)
from src.generation.llm import (
    invoke_groq_with_fallback,
    stream_groq_with_fallback,
    DEFAULT_MODELS,
    MODEL_ALIASES,
)

_SENTINEL = object()


def reformulate_query(query: str, chat_history: Optional[List[Dict[str, Any]]] = None) -> str:
    """Conversational Memory Router: Rephrases ambiguous follow-up questions

    into self-contained standalone search queries using past chat history context.
    Only invokes LLM if the query actually contains referential pronouns or continuations.
    """
    if not chat_history or len(chat_history) < 2:
        return query

    q_lower = query.lower()
    referential_tokens = {
        "he", "his", "him", "she", "her", "it", "its", "they", "them", "their",
        "this", "that", "these", "those", "above", "former", "latter"
    }
    words_set = set(re.findall(r"\w+", q_lower))
    has_reference = bool(words_set & referential_tokens) or any(
        phrase in q_lower for phrase in ["what about", "how about", "and then", "tell me more"]
    )

    if not has_reference:
        return query

    recent = chat_history[-4:]
    formatted_history = "\n".join([f"{msg['role'].upper()}: {msg['content'][:250]}" for msg in recent])

    prompt = QUERY_REFORMULATION_PROMPT.format(
        formatted_history=formatted_history,
        query=query,
    )

    response = invoke_groq_with_fallback(prompt, max_tokens=60)
    return response if response else query


@lru_cache(maxsize=256)
def decompose_query(query: str) -> List[str]:
    """Agentic Query Decomposer: Breaks multi-topic complex inquiries into sub-queries."""
    q_lower = query.lower()
    compound_markers = [" compare ", " vs ", " versus ", " differences between ", " difference between ", " contrast "]
    if not any(marker in q_lower for marker in compound_markers):
        return [query]

    prompt = QUERY_DECOMPOSITION_PROMPT.format(query=query)
    response = invoke_groq_with_fallback(prompt, max_tokens=80)
    if not response:
        return [query]
    return [q.strip() for q in response.split('|') if q.strip()]


def is_vault_meta_query(q: str) -> bool:
    """Detects if the user query is asking for an inventory of documents in the Knowledge Vault."""
    q_lower = q.lower().strip()
    meta_patterns = [
        "what are the docs", "what docs", "which docs", "what files", "which files",
        "list docs", "list the docs", "list files", "list the files",
        "in our knowledge vault", "in the knowledge vault", "in the vault",
        "in our vault", "what documents", "available documents", "uploaded documents",
        "documents in the vault", "files in the vault", "knowledge vault contents",
        "what do we have", "what documents do we have", "what is in the vault"
    ]
    return any(p in q_lower for p in meta_patterns)


def is_conversational_query(q: str) -> bool:
    """Detects conversational greetings, introductions, and pleasantries.

    Guards against compound queries: if the query starts with a greeting but contains
    a substantial question (more than 4 words), it is NOT treated as a pure greeting.
    """
    q_clean = re.sub(r"[^\w\s]", "", q.lower()).strip()
    greetings = {
        "hi", "hello", "hey", "greetings", "good morning", "good afternoon",
        "good evening", "howdy", "sup", "yo", "what's up", "whats up",
        "how are you", "who are you", "what are you", "help", "thanks", "thank you",
    }
    if q_clean in greetings:
        return True

    words = q_clean.split()
    if not words or len(words) > 4:
        return False

    first_word = words[0]
    return first_word in {"hi", "hello", "hey", "howdy", "greetings"}


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
    # Strictly user-scoped stats - NEVER leak other users' files in manifest!
    stats = get_collection_stats(user_id=norm_uid)
    active_files = stats.get("files", [])

    # Build manifest text strictly for user's active files
    manifest_text = "DOCUMENTS CURRENTLY IN THE KNOWLEDGE VAULT:\n"
    if active_files:
        for f in active_files:
            manifest_text += f"- {f}\n"
    else:
        manifest_text += "(No documents currently indexed in the vault)\n"

    instructions_clause = ""
    if custom_instructions and custom_instructions.strip():
        instructions_clause = f"\n    USER PREFERENCES & SPECIAL INSTRUCTIONS:\n    {custom_instructions.strip()}\n"

    # Fast Short-Circuit 1: Conversational Greetings & Pleasantries (e.g. "hi", "hello", "who are you")
    if is_conversational_query(query):
        prompt = CONVERSATIONAL_GREETING_PROMPT.format(
            manifest_text=manifest_text,
            instructions_clause=instructions_clause,
            query=query,
        )
        return prompt, []

    # Fast Short-Circuit 2: Vault inventory / document listing inquiry
    if is_vault_meta_query(query):
        prompt = VAULT_INVENTORY_PROMPT.format(
            manifest_text=manifest_text,
            instructions_clause=instructions_clause,
            query=query,
        )
        return prompt, []

    # Fast Short-Circuit 3: Empty vault and web search disabled
    if not active_files and not web_search:
        prompt = VAULT_EMPTY_PROMPT.format(
            manifest_text=manifest_text,
            instructions_clause=instructions_clause,
            query=query,
        )
        return prompt, []

    standalone_query = reformulate_query(query, chat_history)
    sub_queries = decompose_query(standalone_query)

    q_lower = query.lower()
    search_queries = list(sub_queries)
    if "project" in q_lower and not any("engineering" in sq.lower() for sq in search_queries):
        search_queries.append(standalone_query + " engineering work systems products")

    is_aggregation = any(marker in q_lower for marker in [
        "what are the", "list all", "what are all", "summarize all", "all the",
        "projects", "experience", "work", "skills", "overview", "technologies"
    ])
    retrieval_k = 8 if is_aggregation else settings.DEFAULT_RETRIEVAL_K

    def fetch_local_contexts() -> List[Dict[str, Any]]:
        if not active_files:
            return []
        local_ctx = []
        for sq in search_queries:
            contexts = hybrid_search(sq, k=retrieval_k, user_id=norm_uid, active_filenames=active_files)
            local_ctx.extend(contexts)
        return local_ctx

    def fetch_web_contexts() -> List[Dict[str, Any]]:
        if not web_search:
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
                        "is_web": True
                    })
                for r in tavily_res.get("results", []):
                    title = r.get("title") or "Web Source"
                    snippet = r.get("content", "")
                    url = r.get("url", "")
                    if snippet:
                        w_ctx.append({
                            "filename": f"[Web] {title}",
                            "page": 1,
                            "content": f"{snippet}\nSource URL: {url}",
                            "url": url,
                            "is_web": True
                        })
        except Exception as e:
            logger.warning(f"Tavily search error: {e}")
        return w_ctx

    # Concurrently execute vector and web retrieval
    if web_search:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            local_future = executor.submit(fetch_local_contexts)
            web_future = executor.submit(fetch_web_contexts)
            all_contexts = local_future.result()
            web_contexts = web_future.result()
    else:
        all_contexts = fetch_local_contexts()
        web_contexts = []

    combined_raw_contexts = all_contexts + web_contexts

    if not combined_raw_contexts:
        return None, []

    # Deduplicate contexts preserving rank order
    seen = set()
    unique_contexts = []
    for ctx in combined_raw_contexts:
        c_text = ctx.get('content', '')
        if c_text not in seen:
            seen.add(c_text)
            unique_contexts.append(ctx)

    combined_context = ""
    for idx, ctx in enumerate(unique_contexts, start=1):
        page_info = f", Page {ctx['page']}" if ctx.get('page') and not ctx.get('is_web') else ""
        source_label = ctx['filename']
        combined_context += f"--- SOURCE [{idx}]: {source_label}{page_info} ---\n{ctx['content']}\n\n"

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
    if prepared_prompt is not _SENTINEL:
        prompt = prepared_prompt
    else:
        prompt, _ = prepare_context_and_prompt(query, chat_history, user_id=user_id)

    if not prompt:
        yield "I couldn't find any relevant information in the database to answer that."
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
    if prepared_prompt is not _SENTINEL:
        prompt = prepared_prompt
    else:
        prompt, _ = prepare_context_and_prompt(query, chat_history, user_id=user_id)

    if not prompt:
        return "I couldn't find any relevant information in the database to answer that."

    response = invoke_groq_with_fallback(
        prompt=prompt,
        max_tokens=settings.LLM_MAX_TOKENS,
        temperature=0.0,
    )
    return response if response else "I couldn't generate an answer due to an upstream LLM connection issue."
