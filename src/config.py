import os
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
QDRANT_URL = os.getenv("QDRANT_URL")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
QDRANT_PATH = os.getenv("QDRANT_PATH", "./qdrant_db")
COLLECTION_NAME = "pdf_chunks"

if not GROQ_API_KEY:
    raise ValueError("Missing essential GROQ_API_KEY in .env")