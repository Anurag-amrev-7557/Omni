"""Resilient Groq LPU Inference Service with Automatic Model Failover."""
from typing import Generator, List, Optional
from langchain_groq import ChatGroq

from src.config.settings import settings
from src.core.logging import logger

DEFAULT_MODELS: List[str] = settings.DEFAULT_LLM_MODELS
MODEL_ALIASES: dict[str, str] = settings.MODEL_ALIASES


def resolve_model_name(model_name: Optional[str]) -> str:
    """Resolves human-readable model alias to exact Groq model identifier."""
    if not model_name:
        return settings.PRIMARY_LLM_MODEL
    return MODEL_ALIASES.get(model_name, model_name)


def invoke_groq_with_fallback(
    prompt: str,
    max_tokens: int = 120,
    temperature: float = 0.0,
    models: Optional[List[str]] = None,
    timeout: Optional[float] = None,
) -> str:
    """Invokes ChatGroq with automatic model failover across resilient models."""
    if not settings.GROQ_API_KEY:
        logger.warning("GROQ_API_KEY is not configured - skipping LLM invocation")
        return ""

    model_list = models or DEFAULT_MODELS
    req_timeout = timeout or settings.LLM_TIMEOUT

    for model in model_list:
        try:
            llm = ChatGroq(
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                max_retries=0,
                request_timeout=req_timeout,
                api_key=settings.GROQ_API_KEY,
            )
            res = llm.invoke(prompt)
            return res.content.strip()
        except Exception as e:
            logger.debug(f"Groq model {model} notice: {e}")

    logger.warning("All configured Groq models failed or were rate-limited.")
    return ""


def stream_groq_with_fallback(
    prompt: str,
    model: Optional[str] = None,
    max_tokens: int = 1800,
    temperature: float = 0.0,
    timeout: Optional[float] = None,
) -> Generator[str, None, None]:
    """Streams token chunks from Groq with multi-model failover."""
    if not settings.GROQ_API_KEY:
        yield "Groq API key is not configured. Please set GROQ_API_KEY in your environment."
        return

    models_to_try = list(DEFAULT_MODELS)
    if model:
        resolved = resolve_model_name(model)
        if resolved in models_to_try:
            models_to_try.remove(resolved)
        models_to_try.insert(0, resolved)

    req_timeout = timeout or settings.LLM_TIMEOUT
    has_streamed = False

    for model_name in models_to_try:
        try:
            llm = ChatGroq(
                model=model_name,
                temperature=temperature,
                streaming=True,
                max_tokens=max_tokens,
                max_retries=0,
                request_timeout=req_timeout,
                api_key=settings.GROQ_API_KEY,
            )
            for chunk in llm.stream(prompt):
                if chunk.content:
                    has_streamed = True
                    yield chunk.content
            return
        except Exception as e:
            logger.warning(f"Groq model {model_name} stream error: {e}")
            if has_streamed:
                yield "\n\n*(Stream connection interrupted)*"
                return
            if model_name == models_to_try[-1]:
                yield "\n\n⚠️ *All Groq models failed or rate-limited. Please try again in a few moments.*"
