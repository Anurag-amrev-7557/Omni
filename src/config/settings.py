"""Unified Application Settings and Environment Configuration."""
import os
from pathlib import Path
from typing import List, Optional
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

# Determine project root directory
_DEFAULT_ROOT = Path(__file__).resolve().parent.parent.parent
ROOT_DIR = os.environ.get("APP_ROOT_DIR")
if not ROOT_DIR:
    ROOT_DIR = str(_DEFAULT_ROOT)
ROOT_DIR = os.path.abspath(ROOT_DIR)

ENV_FILE = os.path.join(ROOT_DIR, ".env")


class Settings(BaseSettings):
    """Central settings class loaded from environment and .env file."""
    model_config = SettingsConfigDict(
        env_file=ENV_FILE if os.path.isfile(ENV_FILE) else None,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # General Environment
    APP_ROOT_DIR: str = ROOT_DIR
    ENVIRONMENT: str = "development"
    FRONTEND_URL: str = ""

    # User Defaults
    DEFAULT_LOCAL_USER: str = "10d2f529-3fae-4a29-9a5e-312876700ff9"

    # LLM (Groq) Configuration
    GROQ_API_KEY: str = ""
    PRIMARY_LLM_MODEL: str = "openai/gpt-oss-120b"
    DEFAULT_LLM_MODELS: List[str] = [
        "openai/gpt-oss-120b",
        "openai/gpt-oss-20b",
        "groq/compound-mini",
        "groq/compound",
        "qwen/qwen3.6-27b",
        "qwen/qwen3.8-27b",
    ]
    MODEL_ALIASES: dict[str, str] = {
        "GPT-OSS 120B": "openai/gpt-oss-120b",
        "GPT-OSS 20B": "openai/gpt-oss-20b",
        "Groq Compound Mini": "groq/compound-mini",
        "Groq Compound": "groq/compound",
        "Qwen 3.6 27B": "qwen/qwen3.6-27b",
        "Qwen 3.8 27B": "qwen/qwen3.8-27b",
    }
    LLM_TIMEOUT: float = 20.0
    LLM_MAX_TOKENS: int = 1800

    # Embeddings & Reranker Configuration
    EMBEDDING_MODEL: str = "sentence-transformers/all-MiniLM-L6-v2"
    EMBEDDING_DIMENSION: int = 384
    RERANKER_MODEL: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"
    ENABLE_CROSS_ENCODER: bool = False

    # Qdrant Vector DB Configuration
    QDRANT_URL: str = ""
    QDRANT_API_KEY: str = ""
    QDRANT_PATH: str = Field(default_factory=lambda: os.path.join(ROOT_DIR, "data", "qdrant_db"))
    COLLECTION_NAME: str = "pdf_chunks"
    QDRANT_TIMEOUT: float = 60.0

    # Persistent Relational DB (PostgreSQL / SQLite)
    DATABASE_URL: str = ""
    NEON_DATABASE_URL: str = ""
    CHAT_DB_PATH: str = Field(default_factory=lambda: os.path.join(ROOT_DIR, "data", "chat_history.db"))
    GRAPH_DB_PATH: str = Field(default_factory=lambda: os.path.join(ROOT_DIR, "data", "knowledge_graph.db"))
    DB_POOL_MIN: int = 1
    DB_POOL_MAX: int = 10
    DB_TIMEOUT: float = 10.0

    # File Storage Configuration
    FILE_STORAGE_TYPE: str = "local"  # "local", "s3", "gcs"
    FILE_STORAGE_BUCKET: str = "documents"
    UPLOADS_DIR: str = Field(default_factory=lambda: os.path.join(ROOT_DIR, "data", "uploaded_docs"))
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_REGION: str = "us-east-1"

    # External APIs: Supabase & Tavily
    SUPABASE_URL: str = ""
    SUPABASE_PUBLISHABLE_KEY: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    SUPABASE_SERVICE_KEY: str = ""
    SUPABASE_KEY: str = ""
    TAVILY_API_KEY: str = ""
    WEB_SEARCH_ENABLED: bool = True
    TAVILY_MAX_RESULTS: int = 4
    TAVILY_TIMEOUT: float = 6.0

    # Rate Limiting Configuration
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_CHAT_PER_MINUTE: int = 30
    RATE_LIMIT_SEARCH_PER_MINUTE: int = 15

    # Ingestion & Chunking Parameters
    PARENT_CHUNK_SIZE: int = 2800
    PARENT_CHUNK_OVERLAP: int = 350
    CHILD_CHUNK_SIZE: int = 450
    CHILD_CHUNK_OVERLAP: int = 80
    MAX_UPLOAD_SIZE_MB: int = 50
    ALLOWED_FILE_EXTENSIONS: List[str] = [".pdf", ".txt", ".csv", ".docx", ".md"]

    # Retrieval Tuning
    DEFAULT_RETRIEVAL_K: int = 6
    RRF_K: int = 60
    RRF_DENSE_WEIGHT: float = 0.6
    RRF_SPARSE_WEIGHT: float = 0.4

    def get_effective_postgres_url(self) -> Optional[str]:
        url = self.DATABASE_URL or self.NEON_DATABASE_URL
        return url.strip() if url and url.strip() else None

    def get_effective_supabase_key(self) -> str:
        return (
            self.SUPABASE_SERVICE_ROLE_KEY.strip() or
            self.SUPABASE_SERVICE_KEY.strip() or
            self.SUPABASE_KEY.strip() or
            self.SUPABASE_PUBLISHABLE_KEY.strip()
        )


# Singleton instance
settings = Settings()
