from functools import lru_cache
from typing import Generator
from langchain_groq import ChatGroq

try:
    from src.retrieve import hybrid_search
except ImportError:
    from retrieve import hybrid_search


DEFAULT_MODELS = [
    "openai/gpt-oss-20b",
    "openai/gpt-oss-120b",
    "qwen/qwen3.6-27b",
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant"
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


def reformulate_query(query: str, chat_history: list[dict] = None) -> str:
    """
    CONVERSATIONAL MEMORY ROUTER: Rephrases ambiguous follow-up questions 
    into self-contained standalone search queries using past chat history context.
    """
    if not chat_history or len(chat_history) < 2:
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

@lru_cache(maxsize=256)
def decompose_query(query: str) -> list[str]:
    """
    AGENTIC ROUTING (CACHED): Uses the LLM to break a complex query into simpler sub-queries.
    Cached via @lru_cache to eliminate duplicate LLM roundtrips for repeated prompts.
    """
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


def prepare_context_and_prompt(query: str, chat_history: list[dict] = None) -> tuple[str, list[dict]]:
    """Helper to reformulate, decompose, search vector DB, and format prompt."""
    standalone_query = reformulate_query(query, chat_history)
    sub_queries = decompose_query(standalone_query)
    
    all_contexts = []
    for sq in sub_queries:
        contexts = hybrid_search(sq, limit=3)
        all_contexts.extend(contexts)
        
    if not all_contexts:
        return None, []
        
    # Deduplicate contexts while preserving order
    seen = set()
    unique_contexts = []
    for ctx in all_contexts:
        if ctx['content'] not in seen:
            seen.add(ctx['content'])
            unique_contexts.append(ctx)
            
    combined_context = ""
    for idx, ctx in enumerate(unique_contexts, start=1):
        page_info = f", Page {ctx['page']}" if ctx.get('page') else ""
        combined_context += f"--- SOURCE [{idx}]: {ctx['filename']}{page_info} ---\n{ctx['content']}\n\n"
        
    prompt = f"""
    You are an expert technical analyst. Answer the user's question using ONLY the provided context below.
    
    CRITICAL PRESENTATION & CITATION INSTRUCTIONS:
    1. EXCELLENT PRESENTATION: Present your answer with clean structure. Use bullet points (`-`), bold sub-headers (`**Category:**`), and paragraph breaks. NEVER collapse multiple items or categories into a single unformatted wall of text.
    2. INLINE CITATIONS: Whenever stating a fact or detail from a source, insert a bracketed numerical citation immediately following the statement, e.g., `[1]` or `[1, 2]`.
    3. REFERENCES FOOTER: At the very end of your answer, add a horizontal divider `---` followed by the header `##### References & Sources`. DO NOT use any emojis (such as 📚 or 📖). Write ONLY clean text without any emoji!
    4. CITATION LIST FORMAT: Under `##### References & Sources`, list each referenced source on a new line using this format:

       - **[1] filename.pdf** *(Page X)* — *"Exact short quote or excerpt snippet..."*
    5. If the context does not contain the answer, politely state "I don't know based on the provided documents."

    
    Context:
    {combined_context}
    
    Question: {query}
    """
    return prompt, unique_contexts

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