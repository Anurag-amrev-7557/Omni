from functools import lru_cache
from typing import Generator
from langchain_groq import ChatGroq

try:
    from src.retrieve import hybrid_search
    from src.web_search import search_tavily
except ImportError:
    from retrieve import hybrid_search
    try:
        from web_search import search_tavily
    except ImportError:
        search_tavily = None


import re

DEFAULT_MODELS = [
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "groq/compound",
    "qwen/qwen3.6-27b",
    "qwen/qwen3.8-27b",
]

MODEL_ALIASES = {
    "GPT-OSS 120B": "openai/gpt-oss-120b",
    "GPT-OSS 20B": "openai/gpt-oss-20b",
    "Groq Compound": "groq/compound",
    "Qwen 3.6 27B": "qwen/qwen3.6-27b",
    "Qwen 3.8 27B": "qwen/qwen3.8-27b",
}


def invoke_groq_with_fallback(prompt: str, max_tokens: int = 120) -> str:
    """Helper to invoke Groq with automatic fallback across supported high-performance models."""
    for model_name in DEFAULT_MODELS:
        try:
            llm = ChatGroq(model=model_name, temperature=0, max_tokens=max_tokens, max_retries=0, request_timeout=6.0)
            res = llm.invoke(prompt)
            return res.content.strip()
        except Exception as e:
            print(f"[Warning] Groq model {model_name} invoke notice: {e}")
    return ""


def reformulate_query(query: str, chat_history: list[dict] = None) -> str:
    """
    CONVERSATIONAL MEMORY ROUTER: Rephrases ambiguous follow-up questions 
    into self-contained standalone search queries using past chat history context.
    Only invokes LLM if the query actually contains referential pronouns or continuations.
    """
    if not chat_history or len(chat_history) < 2:
        return query
        
    q_lower = query.lower()
    referential_tokens = {"he", "his", "him", "she", "her", "it", "its", "they", "them", "their", "this", "that", "these", "those", "above", "former", "latter"}
    words_set = set(re.findall(r"\w+", q_lower))
    has_reference = bool(words_set & referential_tokens) or any(phrase in q_lower for phrase in ["what about", "how about", "and then", "tell me more"])

    if not has_reference and len(words_set) >= 4:
        return query

    recent = chat_history[-4:]
    formatted_history = "\n".join([f"{msg['role'].upper()}: {msg['content'][:250]}" for msg in recent])
    
    prompt = f"""Rephrase this follow-up question into a standalone search query based on chat history. Output ONLY the rephrased query without quotes or preamble.

Chat History:
{formatted_history}

Follow-Up: {query}
Standalone Query:"""
    
    response = invoke_groq_with_fallback(prompt, max_tokens=60)
    return response if response else query

@lru_cache(maxsize=256)
def decompose_query(query: str) -> list[str]:
    """
    AGENTIC ROUTING (CACHED): Uses the LLM to break a complex query into simpler sub-queries.
    Cached via @lru_cache. Only invokes LLM when explicit multi-topic comparison conjunctions exist.
    """
    q_lower = query.lower()
    compound_markers = [" compare ", " vs ", " versus ", " differences between ", " difference between ", " contrast "]
    if not any(marker in q_lower for marker in compound_markers):
        return [query]

    prompt = f"""Break this multi-topic search query into separate standalone search queries separated by a pipe character (|). Output ONLY the pipe-separated queries.
Example: Compare revenue of Acme and CEO background -> Acme revenue | CEO background
Query: {query}
Output:"""
    
    response = invoke_groq_with_fallback(prompt, max_tokens=80)
    if not response:
        return [query]
    return [q.strip() for q in response.split('|') if q.strip()]


def is_vault_meta_query(q: str) -> bool:
    """Detects if the user is asking about the documents/files stored in the Knowledge Vault."""
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


def prepare_context_and_prompt(
    query: str, 
    chat_history: list[dict] = None, 
    user_id: str | None = None,
    custom_instructions: str | None = None,
    web_search: bool = False,
) -> tuple[str, list[dict]]:
    """Helper to reformulate, decompose, search vector DB, optionally search web via Tavily, and format prompt."""
    from src.db import get_collection_stats
    stats = get_collection_stats(user_id=user_id)
    active_files = stats.get("files", [])

    standalone_query = reformulate_query(query, chat_history)
    sub_queries = decompose_query(standalone_query)
    
    all_contexts = []
    for sq in sub_queries:
        contexts = hybrid_search(sq, k=3, user_id=user_id)
        all_contexts.extend(contexts)

    # For meta-queries about the vault, explicitly pull representative context from all active files
    if is_vault_meta_query(query) and active_files:
        for fname in active_files:
            doc_contexts = hybrid_search(f"Overview summary and purpose of {fname}", k=2, user_id=user_id)
            all_contexts.extend(doc_contexts)

    # Tavily Web Search augmentation if requested
    web_contexts = []
    if web_search and search_tavily:
        try:
            print(f"[WebSearch] Invoking Tavily web search for: '{standalone_query}'")
            tavily_res = search_tavily(standalone_query, max_results=4, include_answer=True)
            if tavily_res.get("success"):
                if tavily_res.get("answer"):
                    web_contexts.append({
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
                        web_contexts.append({
                            "filename": f"[Web] {title}",
                            "page": 1,
                            "content": f"{snippet}\nSource URL: {url}",
                            "url": url,
                            "is_web": True
                        })
        except Exception as e:
            print(f"[WebSearch Warning] Tavily search error: {e}")
        
    manifest_text = "DOCUMENTS CURRENTLY IN THE KNOWLEDGE VAULT:\n"
    if active_files:
        for f in active_files:
            manifest_text += f"- {f}\n"
    else:
        manifest_text += "(No documents currently indexed in the vault)\n"

    instructions_clause = ""
    if custom_instructions and custom_instructions.strip():
        instructions_clause = f"\n    USER PREFERENCES & SPECIAL INSTRUCTIONS:\n    {custom_instructions.strip()}\n"

    # Merge vector and web contexts
    combined_raw_contexts = all_contexts + web_contexts

    if not combined_raw_contexts:
        if is_vault_meta_query(query) and active_files:
            prompt = f"""
            You are an expert technical analyst. The user is asking about the contents of the Knowledge Vault.
            Use the manifest below to list and describe the documents currently available:
            
            {manifest_text}
            {instructions_clause}
            Question: {query}
            """
            return prompt, []
        return None, []
        
    # Deduplicate contexts while preserving order
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
        
    prompt = f"""
    You are an expert technical analyst. Answer the user's question using the provided context and vault manifest below.
    
    CRITICAL PRESENTATION & CITATION INSTRUCTIONS:
    1. EXCELLENT PRESENTATION: Present your answer with clean structure. Use bullet points (`-`), bold sub-headers (`**Category:**`), and paragraph breaks. NEVER collapse multiple items or categories into a single unformatted wall of text.
    2. INLINE CITATIONS: Whenever stating a fact or detail from a source, insert a bracketed numerical citation immediately following the statement, e.g., `[1]` or `[1, 2]`.
    3. REFERENCES FOOTER: At the very end of your answer, add a horizontal divider `---` followed by the header `##### References & Sources`. DO NOT use any emojis. Write ONLY clean text without any emoji!
    4. CITATION LIST FORMAT: Under `##### References & Sources`, list each referenced source on a new line using this format:

       - For documents: **[1] filename.pdf** *(Page X)* — *"Exact short quote or excerpt snippet..."*
       - For web results: **[1] [Title](url)** — *"Summary or short quote..."*
    5. VAULT INVENTORY QUESTIONS: If the user asks what documents, files, or sources are in the Knowledge Vault, use the 'DOCUMENTS CURRENTLY IN THE KNOWLEDGE VAULT' list and the provided source excerpts to list and describe each document clearly.
    6. If neither the documents nor web results contain the answer, politely state "I don't know based on the provided sources."
    {instructions_clause}
    {manifest_text}
    
    Context:
    {combined_context}
    
    Question: {query}
    """
    return prompt, unique_contexts

def answer_query_stream(
    query: str,
    chat_history: list[dict] = None,
    model: str = None,
    prepared_prompt: str | None = None,
    user_id: str | None = None,
) -> Generator[str, None, None]:
    """Streams answer tokens chunk-by-chunk with automatic fallback for Groq rate limits."""
    if prepared_prompt:
        prompt = prepared_prompt
    else:
        prompt, contexts = prepare_context_and_prompt(query, chat_history, user_id=user_id)
    
    if not prompt:
        yield "I couldn't find any relevant information in the database to answer that."
        return

    models_to_try = list(DEFAULT_MODELS)
    if model:
        resolved = MODEL_ALIASES.get(model, model)
        if resolved in models_to_try:
            models_to_try.remove(resolved)
        models_to_try.insert(0, resolved)

    has_streamed = False
    for model_name in models_to_try:
        try:
            llm = ChatGroq(model=model_name, temperature=0, streaming=True, max_tokens=1800, max_retries=1, request_timeout=35.0)
            for chunk in llm.stream(prompt):
                if chunk.content:
                    has_streamed = True
                    yield chunk.content
            return
        except Exception as e:
            print(f"[Warning] Groq model {model_name} stream error: {e}")
            if has_streamed:
                yield f"\n\n*(Stream connection interrupted)*"
                return
            if model_name == models_to_try[-1]:
                yield f"\n\n⚠️ *All Groq models failed or rate-limited. Please try again in a few moments.*"


def answer_query(query: str, chat_history: list[dict] = None, model: str = None) -> str:
    """Synchronous fallback answer generation with multi-model failover."""
    prompt, contexts = prepare_context_and_prompt(query, chat_history)
    if not prompt:
        return "I couldn't find any relevant information in the database to answer that."

    models_to_try = list(DEFAULT_MODELS)
    if model:
        resolved = MODEL_ALIASES.get(model, model)
        if resolved in models_to_try:
            models_to_try.remove(resolved)
        models_to_try.insert(0, resolved)

    for model_name in models_to_try:
        try:
            llm = ChatGroq(model=model_name, temperature=0, max_retries=1)
            response = llm.invoke(prompt)
            return response.content
        except Exception as e:
            print(f"[Warning] Groq model {model_name} sync error: {e}")

    return "I couldn't generate an answer due to an upstream LLM connection issue."