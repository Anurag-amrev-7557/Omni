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


def is_valid_groq_key(key: Optional[str]) -> bool:
    """Validates that a Groq API key is configured and not the default placeholder."""
    if not key:
        return False
    k = key.strip()
    return bool(k and k != "your_groq_api_key_here" and not k.startswith("your_") and len(k) > 10)


def invoke_groq_with_fallback(
    prompt: str,
    max_tokens: int = 120,
    temperature: float = 0.0,
    models: Optional[List[str]] = None,
    timeout: Optional[float] = None,
) -> str:
    """Invokes ChatGroq with automatic model failover across resilient models."""
    if not is_valid_groq_key(settings.GROQ_API_KEY):
        logger.warning("GROQ_API_KEY is not configured or uses placeholder - skipping LLM invocation")
        return ""

    model_list = models or DEFAULT_MODELS
    req_timeout = timeout or settings.LLM_TIMEOUT

    for model in model_list:
        try:
            extra_kwargs = {}
            if "gpt-oss" in model:
                extra_kwargs["reasoning_format"] = "hidden"
                extra_kwargs["reasoning_effort"] = "low"

            effective_tokens = max_tokens
            if "qwen" in model.lower():
                effective_tokens = min(max_tokens, 1000)

            llm = ChatGroq(
                model=model,
                temperature=temperature,
                max_tokens=effective_tokens,
                max_retries=0,
                request_timeout=req_timeout,
                api_key=settings.GROQ_API_KEY,
                **extra_kwargs,
            )
            res = llm.invoke(prompt)
            content = res.content.strip()
            if content:
                return content
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
    """Streams token chunks from Groq with multi-model failover and diagnostic errors."""
    if not is_valid_groq_key(settings.GROQ_API_KEY):
        yield (
            "⚠️ **Groq API Key Required**\n\n"
            "Your `GROQ_API_KEY` is not set or is still using the default placeholder (`your_groq_api_key_here`).\n\n"
            "To enable conversational responses:\n"
            "1. Obtain a free API key at **[console.groq.com/keys](https://console.groq.com/keys)**\n"
            "2. Set it in your `.env` file in the project root:\n"
            "   ```bash\n"
            "   GROQ_API_KEY=\"gsk_...\"\n"
            "   ```\n"
            "3. Restart the server."
        )
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
            extra_kwargs = {}
            if "gpt-oss" in model_name:
                extra_kwargs["reasoning_format"] = "hidden"
                extra_kwargs["reasoning_effort"] = "low"

            effective_tokens = max_tokens
            if "qwen" in model_name.lower():
                effective_tokens = min(max_tokens, 1000)

            llm = ChatGroq(
                model=model_name,
                temperature=temperature,
                streaming=True,
                max_tokens=effective_tokens,
                max_retries=0,
                request_timeout=req_timeout,
                api_key=settings.GROQ_API_KEY,
                **extra_kwargs,
            )
            for chunk in llm.stream(prompt):
                if chunk.content:
                    has_streamed = True
                    yield chunk.content
            return
        except Exception as e:
            err_str = str(e).lower()
            logger.warning(f"Groq model {model_name} stream error: {e}")
            if "invalid_api_key" in err_str or "invalid api key" in err_str or "401" in err_str:
                yield (
                    f"⚠️ **Invalid Groq API Key (401 Unauthorized)**\n\n"
                    f"The `GROQ_API_KEY` in your `.env` was rejected by Groq:\n"
                    f"> *{e}*\n\n"
                    f"Please verify your key at **[console.groq.com/keys](https://console.groq.com/keys)** and update `.env`."
                )
                return

            if has_streamed:
                yield "\n\n*(Stream connection interrupted)*"
                return

            if model_name == models_to_try[-1]:
                if "rate limit" in err_str or "429" in err_str:
                    yield (
                        "\n\n⚠️ **Groq Rate Limit Exceeded (429)**\n\n"
                        "All configured Groq models have exceeded their per-minute rate limits. Please wait 10–20 seconds before retrying."
                    )
                else:
                    yield (
                        f"\n\n⚠️ **Groq Model Error ({type(e).__name__})**\n\n"
                        f"Failed on model `{model_name}`: {e}\n\n"
                        "Please check your network connection or verify your API key at [console.groq.com](https://console.groq.com)."
                    )
