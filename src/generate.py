import re
from functools import lru_cache
from typing import Generator
from langchain_groq import ChatGroq

try:
    from src.retrieve import hybrid_search
except ImportError:
    from retrieve import hybrid_search


DEFAULT_MODELS = [
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "qwen/qwen3.8-27b",
    "qwen/qwen3.6-27b",
]



def invoke_groq_with_fallback(prompt: str) -> str:
    """Helper to invoke Groq with automatic fallback across supported high-performance models."""
    for model_name in DEFAULT_MODELS:
        try:
            llm = ChatGroq(model=model_name, temperature=0)
            res = llm.invoke(prompt)
            return res.content.strip()
        except Exception as e:
            print(f"[Warning] Groq model {model_name} invoke error: {e}")
    return ""


PRONOUN_TRIGGERS = {
    "it", "its", "they", "them", "their", "this", "that", "these", "those",
    "he", "him", "his", "she", "her", "hers", "what about", "how about",
    "the same", "also", "and then", "former", "latter"
}

def is_conversational_followup(query: str) -> bool:
    """Fast regex/keyword check to avoid unnecessary LLM calls on standalone queries."""
    q_lower = query.lower()
    tokens = set(re.findall(r"\w+", q_lower))
    return bool(tokens & PRONOUN_TRIGGERS) or q_lower.startswith(("and ", "also ", "what about ", "how about "))

def reformulate_query(query: str, chat_history: list[dict] = None) -> str:
    """
    CONVERSATIONAL MEMORY ROUTER: Rephrases ambiguous follow-up questions 
    into self-contained standalone search queries using past chat history context.
    """
    if not chat_history or len(chat_history) < 2 or not is_conversational_followup(query):
        return query
        
    recent = chat_history[-4:]
    formatted_history = "\n".join([f"{msg['role'].upper()}: {msg['content']}" for msg in recent])
    
    prompt = f"""
    Given the following conversation history and a follow-up question, rephrase the follow-up question to be a standalone question.
    If the follow-up question is already standalone, return it as is. Do NOT answer the question.

    Chat History:
    {formatted_history}

    Follow-Up Question: {query}
    Standalone Question:
    """
    
    response = invoke_groq_with_fallback(prompt)
    return response if response else query

def should_decompose_query(query: str) -> bool:
    """Checks if query requires multi-hop decomposition."""
    q_lower = query.lower()
    return (
        len(query.split()) > 10
        and any(k in q_lower for k in ["compare", " vs ", "versus", "difference between", "both "])
    )

@lru_cache(maxsize=256)
def decompose_query(query: str) -> list[str]:
    """
    AGENTIC ROUTING (CACHED): Uses the LLM to break a complex query into simpler sub-queries.
    Fast-paths single topic queries directly without LLM latency.
    """
    if not should_decompose_query(query):
        return [query]

    prompt = f"""
    You are a search query optimizer. 
    If the user's prompt asks about multiple distinct topics that are likely in different documents, 
    break it into separate, standalone search queries.
    Separate each query with a pipe character (|). 
    If it is a single topic, just output the original query.
    
    Example Input: "Compare the revenue of Acme Corp and the CEO's background."
    Example Output: Acme Corp revenue | CEO background
    
    Input: {query}
    Output:
    """
    
    response = invoke_groq_with_fallback(prompt)
    if not response:
        return [query]
    return [q.strip() for q in response.split('|') if q.strip()]


def prepare_context_and_prompt(
    query: str,
    chat_history: list[dict] = None,
    web_search: bool = False
) -> tuple[str, list[dict]]:
    """Fast-path context and prompt preparation blending Vault vectors and real-time Web intelligence."""
    standalone_query = reformulate_query(query, chat_history)
    sub_queries = decompose_query(standalone_query)
    
    # Always include the user's direct raw query alongside reformulated and decomposed queries
    search_queries = list(dict.fromkeys([query, standalone_query] + sub_queries))
    
    all_contexts = []
    for sq in search_queries:
        if not sq.strip():
            continue
        contexts = hybrid_search(sq, k=6)
        all_contexts.extend(contexts)
        
    # Deduplicate vault contexts by parent_content and content while preserving order
    seen = set()
    unique_contexts = []
    for ctx in all_contexts:
        parent = ctx.get('parent_content') or ctx.get('content') or ''
        key = (ctx.get('filename'), ctx.get('page'), parent[:80])
        if key not in seen:
            seen.add(key)
            unique_contexts.append(ctx)

    # 2. Live Web Research if requested or triggered
    web_contexts = []
    if web_search or "@web" in query.lower():
        try:
            from src.web_search import search_web_knowledge, format_web_contexts_for_prompt
            clean_q = query.replace("@web", "").strip()
            web_results = search_web_knowledge(clean_q, max_results=4)
            if web_results:
                _, web_contexts = format_web_contexts_for_prompt(web_results, start_idx=len(unique_contexts) + 1)
        except Exception as exc:
            print(f"[Warning] Web research error: {exc}")

    combined_all = unique_contexts + web_contexts
    if not combined_all:
        prompt = f"""
        You are Omni, a highly intelligent and helpful AI assistant.
        Answer the user's question directly, clearly, thoughtfully, and with structured formatting (bullet points, bold key points, and clear paragraphs).
        
        Question: {query}
        """
        return prompt, []
            
    combined_context = ""
    for idx, ctx in enumerate(combined_all, start=1):
        if ctx.get("source_type") == "web":
            combined_context += f"--- WEB SOURCE [{idx}]: {ctx.get('title', 'Web Result')} ({ctx.get('domain', 'web')}) ---\nURL: {ctx.get('url', '')}\n{ctx.get('content', '').strip()}\n\n"
        else:
            page_info = f", Page {ctx['page']}" if ctx.get('page') else ""
            full_text = ctx.get('parent_content') or ctx.get('content') or ""
            combined_context += f"--- VAULT SOURCE [{idx}]: {ctx['filename']}{page_info} ---\n{full_text.strip()}\n\n"
        
    prompt = f"""
    You are an expert enterprise research analyst and intelligent AI assistant. Answer the user's question accurately, thoroughly, and directly.
    
    CRITICAL PRESENTATION & CITATION INSTRUCTIONS:
    1. EXCELLENT PRESENTATION: Present your answer with clean structure. Use bullet points (`-`), bold sub-headers (`**Category:**`), and clear line breaks. NEVER collapse multiple items or categories into a single unformatted wall of text.
    2. ACCURATE EXTRACTION & SYNTHESIS: If the context contains relevant information (from private Knowledge Vault documents or Web findings), synthesize it thoroughly and cite it accurately. If the provided context is unrelated to the question (e.g. general knowledge, reasoning, or advice queries), answer the user's question directly, thoughtfully, and helpfully.
    3. INLINE CITATIONS: Whenever stating a fact, price, finding, or detail from a relevant source, insert a bracketed numerical citation immediately following the statement, e.g., `[1]` or `[1, 2]`.
    4. REFERENCES FOOTER: If you cited specific sources from the context, at the very end of your answer add a horizontal divider `---` followed by the header `##### References & Sources`. DO NOT use any emojis.
    5. CITATION LIST FORMAT: Under `##### References & Sources`, list each cited source on a new line using this format:
       - For Vault Documents: `- **[X] filename.pdf** *(Page Y)* — *"Exact short quote snippet..."*`
       - For Web Pages: `- **[X] [Page Title](URL)** *(domain.com)* — *"Exact short excerpt snippet..."*`
    
    Context:
    {combined_context}
    
    Question: {query}
    """
    return prompt, combined_all

def answer_query_stream(query: str, chat_history: list[dict] = None) -> Generator[str, None, None]:
    """Streams answer tokens chunk-by-chunk with automatic fallback for Groq rate limits."""
    prompt, contexts = prepare_context_and_prompt(query, chat_history)
    
    if not prompt:
        yield "I couldn't find any relevant information in the database to answer that."
        return

    for model_name in DEFAULT_MODELS:
        try:
            llm = ChatGroq(model=model_name, temperature=0, streaming=True)
            for chunk in llm.stream(prompt):
                if chunk.content:
                    yield chunk.content
            return
        except Exception as e:
            print(f"[Warning] Groq model {model_name} stream error: {e}")
            if model_name == DEFAULT_MODELS[-1]:
                yield f"\n\n⚠️ *Groq API Rate Limit reached (429). Please try again in a few minutes or switch model.*"

def answer_query_stream_with_prompt(prompt: str) -> Generator[str, None, None]:
    """Streams answer tokens chunk-by-chunk using a pre-prepared prompt (avoids duplicate context preparation)."""
    if not prompt:
        yield "I couldn't find any relevant information in the database to answer that."
        return

    for model_name in DEFAULT_MODELS:
        try:
            llm = ChatGroq(model=model_name, temperature=0, streaming=True)
            for chunk in llm.stream(prompt):
                if chunk.content:
                    yield chunk.content
            return
        except Exception as e:
            print(f"[Warning] Groq model {model_name} stream error: {e}")
            if model_name == DEFAULT_MODELS[-1]:
                yield f"\n\n⚠️ *Groq API Rate Limit reached (429). Please try again in a few minutes or switch model.*"


def answer_query(query: str, chat_history: list[dict] = None) -> str:
    """Synchronous fallback answer generation with multi-model failover."""
    prompt, contexts = prepare_context_and_prompt(query, chat_history)
    if not prompt:
        return "I couldn't find any relevant information in the database to answer that."

    for model_name in DEFAULT_MODELS:
        try:
            llm = ChatGroq(model=model_name, temperature=0)
            response = llm.invoke(prompt)
            return response.content
        except Exception as e:
            print(f"[Warning] Groq model {model_name} sync error: {e}")

    return "I couldn't generate an answer due to an upstream LLM connection issue."

def answer_query_with_prompt(prompt: str) -> str:
    """Synchronous fallback answer generation using a pre-prepared prompt."""
    if not prompt:
        return "I couldn't find any relevant information in the database to answer that."

    for model_name in DEFAULT_MODELS:
        try:
            llm = ChatGroq(model=model_name, temperature=0)
            response = llm.invoke(prompt)
            return response.content
        except Exception as e:
            print(f"[Warning] Groq model {model_name} sync error: {e}")

    return "I couldn't generate an answer due to an upstream LLM connection issue."