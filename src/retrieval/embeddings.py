"""Embeddings model loader with ONNX runtime FastEmbed and HuggingFace fallback."""
from functools import lru_cache
from src.config.settings import settings
from src.core.logging import logger


@lru_cache(maxsize=1)
def get_embeddings():
    """Lazy loader for embeddings. Prefers FastEmbed (lightweight ONNX runtime) with HuggingFace fallback."""
    try:
        from langchain_community.embeddings.fastembed import FastEmbedEmbeddings
        logger.debug(f"Loaded FastEmbed embeddings: {settings.EMBEDDING_MODEL}")
        return FastEmbedEmbeddings(model_name=settings.EMBEDDING_MODEL)
    except Exception as e:
        logger.debug(f"FastEmbed unavailable ({e}), falling back to HuggingFaceEmbeddings")
        from langchain_huggingface import HuggingFaceEmbeddings
        return HuggingFaceEmbeddings(model_name=settings.EMBEDDING_MODEL.split("/")[-1])
