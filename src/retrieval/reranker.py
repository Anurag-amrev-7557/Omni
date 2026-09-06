"""Cross-Encoder reranking loader and execution."""
from functools import lru_cache
from src.config.settings import settings
from src.core.logging import logger


@lru_cache(maxsize=1)
def get_reranker():
    """Lazy loader for cross-encoder reranker to avoid loading PyTorch during server startup."""
    from sentence_transformers import CrossEncoder
    logger.info(f"Loaded CrossEncoder: {settings.RERANKER_MODEL}")
    return CrossEncoder(settings.RERANKER_MODEL)
