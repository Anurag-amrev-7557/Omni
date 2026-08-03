import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Determine ROOT_DIR safely for both local dev and containerized/deployed environments
ROOT_DIR = os.environ.get("APP_ROOT_DIR")
if not ROOT_DIR:
    ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT_DIR = os.path.abspath(ROOT_DIR)

# Load .env file only if it exists (won't break in containers)
env_file = os.path.join(ROOT_DIR, ".env")
if os.path.isfile(env_file):
    load_dotenv(env_file)
else:
    # In production, environment variables come from the platform (Render, Vercel, etc.)
    print(f"[Config] .env file not found at {env_file} - using environment variables")

# ============================================================
# REQUIRED CONFIGURATION FOR PRODUCTION DEPLOYMENTS
# ============================================================

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
if not GROQ_API_KEY:
    print("[WARNING] GROQ_API_KEY is not configured - LLM features will be unavailable")

# ============================================================
# QDRANT VECTOR DATABASE CONFIGURATION
# ============================================================
# Production: Use Qdrant Cloud (remote). Set QDRANT_URL and QDRANT_API_KEY
# Local dev: Falls back to embedded SQLite storage if QDRANT_URL not set
# ============================================================

QDRANT_URL = os.getenv("QDRANT_URL", "").strip()
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY", "").strip()
QDRANT_PATH = os.getenv("QDRANT_PATH", "").strip()

# Use configured path or default to local embedding
if not QDRANT_PATH:
    QDRANT_PATH = os.path.join(ROOT_DIR, "data", "qdrant_db")

COLLECTION_NAME = "pdf_chunks"

# ============================================================
# PERSISTENT DATABASE CONFIGURATION
# ============================================================
# For production, these should point to managed databases:
# - Chat history: PostgreSQL (Neon, Supabase, AWS RDS)
# - Knowledge graph: PostgreSQL (same as chat history)
# Local dev: Falls back to SQLite for development
# ============================================================

DB_URL = os.getenv("DATABASE_URL", "").strip()
# If DB_URL provided, it overrides local SQLite paths
# Expected format: postgresql://user:password@host:port/dbname

# Local database paths (used if DATABASE_URL not provided)
CHAT_DB_PATH = os.getenv("CHAT_DB_PATH", os.path.join(ROOT_DIR, "data", "chat_history.db"))
GRAPH_DB_PATH = os.getenv("GRAPH_DB_PATH", os.path.join(ROOT_DIR, "data", "knowledge_graph.db"))

# ============================================================
# FILE STORAGE CONFIGURATION
# ============================================================
# For production, use S3/GCS bucket. Set FILE_STORAGE_TYPE = "s3" or "gcs"
# Local dev: Falls back to local filesystem in data/uploaded_docs
# ============================================================

FILE_STORAGE_TYPE = os.getenv("FILE_STORAGE_TYPE", "local").strip().lower()  # "local", "s3", "gcs"
FILE_STORAGE_BUCKET = os.getenv("FILE_STORAGE_BUCKET", "").strip()
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID", "").strip()
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY", "").strip()
AWS_REGION = os.getenv("AWS_REGION", "us-east-1").strip()

# Local file storage path (used if FILE_STORAGE_TYPE = "local")
UPLOADS_DIR = os.getenv("UPLOADS_DIR", os.path.join(ROOT_DIR, "data", "uploaded_docs"))

# ============================================================
# EXTERNAL APIs
# ============================================================

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_PUBLISHABLE_KEY = os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "").strip()

# ============================================================
# FRONTEND CONFIGURATION
# ============================================================

FRONTEND_URL = os.getenv("FRONTEND_URL", "").strip()
ENVIRONMENT = os.getenv("ENVIRONMENT", "development").strip().lower()  # "development", "staging", "production"

# ============================================================
# VALIDATION & WARNINGS
# ============================================================

if ENVIRONMENT == "production":
    if not QDRANT_URL:
        print("[CRITICAL] Production deployment detected but QDRANT_URL not configured!")
        print("           Set QDRANT_URL to use Qdrant Cloud (embedded storage will NOT persist)")
    if FILE_STORAGE_TYPE == "local":
        print("[CRITICAL] Production deployment detected but using local file storage!")
        print("           Set FILE_STORAGE_TYPE=s3, FILE_STORAGE_BUCKET, and AWS credentials")
    if not FRONTEND_URL:
        print("[WARNING] FRONTEND_URL not configured - CORS may fail in production")
else:
    print(f"[Config] Environment: {ENVIRONMENT}")
    print(f"[Config] App root: {ROOT_DIR}")
    if QDRANT_URL:
        print(f"[Config] Using remote Qdrant: {QDRANT_URL[:50]}...")
    else:
        print(f"[Config] Using embedded Qdrant at: {QDRANT_PATH}")
    print(f"[Config] File storage: {FILE_STORAGE_TYPE} ({UPLOADS_DIR if FILE_STORAGE_TYPE == 'local' else FILE_STORAGE_BUCKET})")