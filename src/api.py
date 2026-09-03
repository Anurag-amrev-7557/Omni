import os
import sys
import json
import shutil
import tempfile
import asyncio
import time
from typing import Optional, List
from pydantic import BaseModel

# --- PATH RESOLUTION & CONFIG ---
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SRC_DIR = os.path.abspath(os.path.dirname(__file__))
for _p in (ROOT_DIR, SRC_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from fastapi import FastAPI, File, UploadFile, Query, HTTPException, BackgroundTasks, Depends, Header, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response, JSONResponse, FileResponse
try:
    from src.auth import require_user, set_current_user, DEFAULT_LOCAL_USER
except ImportError:
    try:
        from auth import require_user, set_current_user, DEFAULT_LOCAL_USER
    except ImportError:
        DEFAULT_LOCAL_USER = "10d2f529-3fae-4a29-9a5e-312876700ff9"
        def require_user(authorization: Optional[str] = Header(default=None)) -> str:
            return DEFAULT_LOCAL_USER
        def set_current_user(user_id: str):
            pass

try:
    from src.db import init_db, clear_collection, get_collection_stats, delete_file_from_collection, delete_files_from_collection, delete_user_vectors
    from src.ingest import ingest_file, extract_graph_for_file
    from src.generate import answer_query_stream, prepare_context_and_prompt
    from src.chat_db import init_chat_db, create_session, get_all_sessions, add_message, save_message_async, get_session_messages, delete_session, delete_user_sessions
    from src.pdf_viewer import render_pdf_page_image, get_pdf_page_count, extract_pdf_page_text
except ImportError:
    from db import init_db, clear_collection, get_collection_stats, delete_file_from_collection, delete_files_from_collection, delete_user_vectors
    from ingest import ingest_file, extract_graph_for_file
    from generate import answer_query_stream, prepare_context_and_prompt
    from chat_db import init_chat_db, create_session, get_all_sessions, add_message, save_message_async, get_session_messages, delete_session, delete_user_sessions
    from pdf_viewer import render_pdf_page_image, get_pdf_page_count, extract_pdf_page_text

app = FastAPI(
    title="Enterprise Multi-Document RAG API",
    description="Commercial REST API for Agentic RAG with Groq LPUs, Cross-Encoder Reranking, and PyMuPDF.",
    version="2.0.0"
)

app = FastAPI(
    title="Enterprise Multi-Document RAG API",
    description="Commercial REST API for Agentic RAG with Groq LPUs, Cross-Encoder Reranking, and PyMuPDF.",
    version="2.0.0"
)

# ============================================================
# CORS CONFIGURATION - PRODUCTION SAFE
# ============================================================
# Allow origins based on environment:
# - Development: localhost origins
# - Production: Frontend URL from environment variable
# ============================================================

def get_allowed_origins():
    """Dynamically configure CORS origins based on environment."""
    origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "https://omni-phi-jade.vercel.app",
        "https://omni-lufq.onrender.com",
    ]
    
    # Add production frontend URL if configured
    if frontend_env := os.getenv("FRONTEND_URL", "").strip():
        origins.append(frontend_env)
        if not frontend_env.startswith("http://www.") and not frontend_env.startswith("https://www."):
            origins.append(frontend_env.replace("https://", "https://www."))
    
    return list(set(origins))

def get_allowed_origin_regex():
    """Permissive regex allowing all Vercel deployments, Render services, and local dev."""
    # Matches:
    # - https://omni-phi-jade.vercel.app and any *.vercel.app preview branches
    # - https://omni-lufq.onrender.com and any *.onrender.com instances
    # - http://localhost:* and http://127.0.0.1:*
    return r"^https?://([a-zA-Z0-9_-]+\.)*(vercel\.app|onrender\.com|fly\.dev)(:[0-9]+)?$|^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?$"

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_origin_regex=get_allowed_origin_regex(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=86400,
)


@app.on_event("startup")
async def startup_event():
    def _run_inits():
        try:
            init_db()
        except Exception as e:
            print(f"[WARNING] Failed to initialize Qdrant at startup: {e}")
        try:
            init_chat_db()
        except Exception as e:
            print(f"[WARNING] Failed to initialize chat database at startup: {e}")
        try:
            from src.docs_db import init_docs_db
            init_docs_db()
        except Exception as e:
            print(f"[WARNING] Failed to initialize documents metadata database at startup: {e}")
        try:
            from src.graph_db import init_graph_db
            init_graph_db()
        except Exception as e:
            print(f"[WARNING] Failed to initialize knowledge graph database at startup: {e}")

    async def _periodic_stale_guest_cleanup():
        """Periodically cleans up any guest sessions older than 2 hours."""
        while True:
            try:
                await asyncio.sleep(1800)  # Check every 30 minutes
                uploads_dir = os.path.join(ROOT_DIR, "data", "uploaded_docs")
                if os.path.exists(uploads_dir):
                    now = time.time()
                    for item in os.listdir(uploads_dir):
                        if item.startswith("guest_"):
                            item_path = os.path.join(uploads_dir, item)
                            if os.path.isdir(item_path):
                                # If older than 2 hours (7200 seconds)
                                if now - os.path.getmtime(item_path) > 7200:
                                    print(f"[GuestCleanup] Pruning stale guest directory: {item}")
                                    cleanup_guest_session(item)
            except Exception as e:
                print(f"[GuestCleanup Warning] Periodic cleanup encountered error: {e}")

    asyncio.create_task(asyncio.to_thread(_run_inits))
    asyncio.create_task(_periodic_stale_guest_cleanup())

@app.get("/")
def root():
    return {"status": "online", "service": "Omni RAG", "version": "2.0.0"}

@app.get("/api/health")
def health_check():
    import time
    pipeline = {}
    overall_ok = True

    # 1. Vector Database (Qdrant)
    try:
        from src.db import get_qdrant_client, COLLECTION_NAME
        client = get_qdrant_client()
        collections = client.get_collections().collections
        qdrant_ok = any(c.name == COLLECTION_NAME for c in collections)
        count_info = client.count(COLLECTION_NAME).count if qdrant_ok else 0
        pipeline["qdrant"] = {
            "status": "online" if qdrant_ok else "uninitialized",
            "collection": COLLECTION_NAME,
            "vector_count": count_info,
            "dimension": 384
        }
    except Exception as e:
        pipeline["qdrant"] = {"status": "error", "error": str(e)}
        overall_ok = False

    # 2. Knowledge Graph & SQLite Storage
    try:
        from src.graph_db import get_db_connection, init_graph_db
        init_graph_db()
        conn = get_db_connection()
        c = conn.cursor()
        c.execute("SELECT COUNT(*) FROM graph_entities")
        entity_count = c.fetchone()[0]
        c.execute("SELECT COUNT(*) FROM graph_relations")
        rel_count = c.fetchone()[0]
        conn.close()
        pipeline["graph_db"] = {
            "status": "online",
            "entities": entity_count,
            "relations": rel_count
        }
    except Exception as e:
        pipeline["graph_db"] = {"status": "error", "error": str(e)}
        overall_ok = False

    # 3. LLM API (Groq)
    groq_key = os.getenv("GROQ_API_KEY", "")
    pipeline["llm"] = {
        "provider": "Groq Cloud",
        "status": "online" if len(groq_key) > 10 else "missing_key",
        "default_model": "openai/gpt-oss-120b"
    }
    if len(groq_key) <= 10:
        overall_ok = False

    # 4. Dense Embeddings
    pipeline["embeddings"] = {
        "status": "online",
        "model": "BAAI/bge-small-en-v1.5",
        "dimension": 384,
        "mode": "FastEmbed ONNX"
    }

    return {
        "status": "healthy" if overall_ok else "degraded",
        "version": "2.0.0",
        "pipeline": pipeline,
        "timestamp": time.time()
    }

@app.post("/api/admin/rebuild-qdrant")
def rebuild_qdrant_indexes():
    """
    ADMIN ENDPOINT: Recreate Qdrant collection with proper indexes.
    Use if you get 'Index required' errors from Qdrant.
    
    This endpoint is intentionally simple to allow one-click fixes in production.
    """
    try:
        from src.db import clear_collection, init_db, COLLECTION_NAME
        
        print("[Admin] Rebuilding Qdrant collection and indexes...")
        clear_collection()
        init_db()
        
        return {
            "success": True,
            "message": f"Qdrant collection '{COLLECTION_NAME}' recreated with proper indexes",
            "status": "online"
        }
    except Exception as e:
        print(f"[Admin] Error rebuilding Qdrant: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error rebuilding Qdrant: {str(e)}")

@app.get("/api/stats")
def get_stats(response: Response, user_id: str = Depends(require_user)):
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    set_current_user(user_id)
    stats = get_collection_stats(user_id=user_id)
    sessions = get_all_sessions(user_id=user_id)
    return {
        "status": "Active",
        "total_chunks": stats["total_chunks"],
        "files_count": len(stats["files"]),
        "files": stats["files"],
        "sessions_count": len(sessions)
    }

def is_guest_or_default_user(user_id: str | None) -> bool:
    """Determine if user is a guest or local default user (not authenticated)."""
    return not user_id or user_id in ("default_user", DEFAULT_LOCAL_USER, "00000000-0000-0000-0000-000000000000") or str(user_id).startswith("guest_")

def is_ephemeral_guest(user_id: str | None) -> bool:
    """Determine if user is an ephemeral guest session (will be cleaned up)."""
    return bool(user_id and str(user_id).startswith("guest_"))

def _validate_filename(filename: str) -> str:
    """Sanitize filename to prevent path traversal attacks."""
    # Remove any directory components
    safe_name = os.path.basename(filename)
    # Remove null bytes and other problematic characters
    safe_name = safe_name.replace("\x00", "").replace("\\", "/")
    # Don't allow files starting with dot (hidden files)
    if safe_name.startswith("."):
        raise ValueError(f"Invalid filename: {safe_name}")
    if not safe_name or len(safe_name) > 255:
        raise ValueError(f"Invalid filename length: {safe_name}")
    return safe_name

def _validate_user_id(user_id: str | None) -> str:
    """Validate user_id to prevent path traversal in directory names."""
    if not user_id or user_id in ("default_user", DEFAULT_LOCAL_USER):
        return "default"
    
    user_id = str(user_id).strip()
    
    # Ephemeral guests: guest_{uuid}
    if user_id.startswith("guest_"):
        # Only allow alphanumeric, hyphens, underscores
        if not all(c.isalnum() or c in "_-" for c in user_id):
            raise ValueError(f"Invalid guest user_id format: {user_id}")
        return user_id
    
    # Authenticated users: assume UUID or alphanumeric ID
    if not all(c.isalnum() or c in "_-" for c in user_id):
        raise ValueError(f"Invalid user_id format: {user_id}")
    
    return user_id

def get_user_uploads_dir(user_id: str | None) -> str:
    """
    Returns dedicated directory for uploaded files.
    
    On Render (production): Uses /tmp or skips (files uploaded to Supabase)
    On local dev: Uses local directory
    """
    validated_user_id = _validate_user_id(user_id)
    
    # For Render/production deployments, use /tmp (ephemeral but writable)
    # Files should be uploaded to Supabase Storage instead
    env = os.getenv("ENVIRONMENT", "development").lower()
    
    if env == "production":
        # Use /tmp for temporary storage during ingestion
        user_dir = os.path.join("/tmp", "rag_uploads", validated_user_id)
    else:
        # Local development: use data directory
        from src.config import UPLOADS_DIR
        user_dir = os.path.join(UPLOADS_DIR, validated_user_id)
    
    # Try to create, but don't fail if we can't (might be in production with /tmp issues)
    try:
        os.makedirs(user_dir, exist_ok=True)
    except Exception as e:
        if env != "production":
            print(f"[Upload] Warning: Could not create upload directory {user_dir}: {e}")
    
    return user_dir

def resolve_document_path(filename: str, user_id: str | None = None) -> Optional[str]:
    """
    Safely resolves document file path with protection against traversal attacks.
    
    Returns the full path to the file if found and accessible, None otherwise.
    """
    from src.config import UPLOADS_DIR, ROOT_DIR
    
    try:
        safe_name = _validate_filename(filename)
    except ValueError as e:
        print(f"[Security] Invalid filename prevented: {e}")
        return None
    
    try:
        validated_user_id = _validate_user_id(user_id)
    except ValueError as e:
        print(f"[Security] Invalid user_id prevented: {e}")
        return None
    
    # 1. Check user-specific directory on local disk
    user_dir = os.path.join(UPLOADS_DIR, validated_user_id)
    p = os.path.join(user_dir, safe_name)
    if os.path.exists(p) and os.path.isfile(p):
        return p

    # 2. Download from Supabase Storage for this user_id if present in cloud bucket
    try:
        from src.supabase_storage import download_file
        os.makedirs(user_dir, exist_ok=True)
        download_file(f"users/{validated_user_id}/{safe_name}", p)
        if os.path.exists(p) and os.path.isfile(p):
            return p
    except Exception:
        pass

    # 3. Check fallback local directories for shared/default files
    for check_dir in [
        os.path.join(UPLOADS_DIR, "default"),
        os.path.join(UPLOADS_DIR, DEFAULT_LOCAL_USER),
        UPLOADS_DIR,
        os.path.join(ROOT_DIR, "data"),
    ]:
        fp = os.path.join(check_dir, safe_name)
        if os.path.exists(fp) and os.path.isfile(fp):
            return fp

    # 4. Check fallback Supabase Storage folders (default or shared local user)
    for fallback_uid in ["default", DEFAULT_LOCAL_USER]:
        try:
            from src.supabase_storage import download_file
            fb_path = os.path.join(UPLOADS_DIR, fallback_uid, safe_name)
            os.makedirs(os.path.join(UPLOADS_DIR, fallback_uid), exist_ok=True)
            download_file(f"users/{fallback_uid}/{safe_name}", fb_path)
            if os.path.exists(fb_path) and os.path.isfile(fb_path):
                return fb_path
        except Exception:
            pass

    return None

def cleanup_guest_session(guest_id: str):
    """
    Purges all files, vectors, knowledge graph, and chat sessions for an ephemeral guest.
    
    Uses file locks to prevent race conditions during cleanup.
    """
    import time
    import fcntl
    
    if not guest_id or not guest_id.startswith("guest_"):
        return
    
    print(f"[GuestCleanup] Cleaning up ephemeral guest session: {guest_id}")
    
    # Acquire lock to prevent concurrent cleanup or access
    lock_file = os.path.join(ROOT_DIR, "data", ".cleanup_lock", f"{guest_id}.lock")
    os.makedirs(os.path.dirname(lock_file), exist_ok=True)
    
    try:
        with open(lock_file, "w") as lock_fd:
            # Use non-blocking lock to avoid deadlocks
            try:
                fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except (IOError, BlockingIOError):
                # Another process is already cleaning this guest
                print(f"[GuestCleanup] Skipping {guest_id} - cleanup already in progress")
                return
            
            # 1. Purge vectors in Qdrant
            try:
                delete_user_vectors(guest_id)
            except Exception as e:
                print(f"[GuestCleanup Error] Qdrant cleanup failed for {guest_id}: {e}")

            # 2. Purge knowledge graph
            try:
                from src.graph_db import clear_user_graph
                clear_user_graph(guest_id)
            except Exception as e:
                print(f"[GuestCleanup Error] Graph cleanup failed for {guest_id}: {e}")

            # 3. Purge chat sessions
            try:
                delete_user_sessions(guest_id)
            except Exception as e:
                print(f"[GuestCleanup Error] Chat sessions cleanup failed for {guest_id}: {e}")

            # 4. Remove physical uploaded files directory
            try:
                guest_dir = os.path.join(ROOT_DIR, "data", "uploaded_docs", guest_id)
                if os.path.exists(guest_dir) and os.path.isdir(guest_dir):
                    shutil.rmtree(guest_dir, ignore_errors=True)
                    print(f"[GuestCleanup] Removed directory: {guest_dir}")
            except Exception as e:
                print(f"[GuestCleanup Error] Directory cleanup failed for {guest_id}: {e}")
            
            # Release lock
            fcntl.flock(lock_fd, fcntl.LOCK_UN)
    except Exception as e:
        print(f"[GuestCleanup Error] Lock acquisition failed for {guest_id}: {e}")
    finally:
        # Clean up lock file
        try:
            if os.path.exists(lock_file):
                os.remove(lock_file)
        except Exception:
            pass

@app.post("/api/guest/cleanup")
@app.get("/api/guest/cleanup")
def guest_cleanup_endpoint(guest_id: Optional[str] = Query(None), user_id: str = Depends(require_user)):
    """Called on browser beforeunload or tab close to prune ephemeral guest data."""
    target_id = guest_id or user_id
    if target_id and str(target_id).startswith("guest_"):
        cleanup_guest_session(target_id)
        return {"success": True, "cleaned_guest_id": target_id}
    return {"success": False, "message": "Not an ephemeral guest or no guest_id provided"}

@app.get("/api/documents")
def get_documents(response: Response = None, user_id: str = Depends(require_user)):
    if response:
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    set_current_user(user_id)
    
    # Concurrently fetch stats, Postgres records, and Supabase Storage metadata
    import concurrent.futures
    from src.docs_db import get_user_documents
    from src.supabase_storage import get_user_files

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        stats_future = executor.submit(get_collection_stats, user_id=user_id)
        db_docs_future = executor.submit(get_user_documents, user_id=user_id)
        storage_files_future = executor.submit(get_user_files, user_id)

        try:
            stats = stats_future.result(timeout=5)
        except Exception:
            stats = {"total_chunks": 0, "files": []}

        try:
            db_docs = db_docs_future.result(timeout=5)
        except Exception as e:
            print(f"[Documents] DB lookup notice: {e}")
            db_docs = []

        try:
            storage_files = storage_files_future.result(timeout=5)
        except Exception:
            storage_files = []

    available_files = []
    seen = set()

    # 1. Primary: Load persisted document records from PostgreSQL (Neon/Supabase)
    for doc in db_docs:
        fname = doc["filename"]
        if fname not in seen and not fname.startswith("."):
            seen.add(fname)
            available_files.append({
                "filename": fname,
                "size_mb": doc.get("size_mb", 0.0),
                "pages": doc.get("pages", 1),
                "indexed": fname in stats["files"] or doc.get("indexed", True),
                "status": doc.get("status", "ready"),
                "summary": doc.get("summary", "")
            })

    # 2. Supabase Storage listing for files uploaded to cloud bucket
    for sf in storage_files:
        fname = sf.get("name")
        if fname and fname not in seen and not fname.startswith("."):
            seen.add(fname)
            metadata = sf.get("metadata", {})
            size_mb = round(metadata.get("size", 0) / (1024 * 1024), 2)
            available_files.append({
                "filename": fname,
                "size_mb": size_mb,
                "pages": 1,
                "indexed": fname in stats["files"],
                "status": "ready"
            })
    
    def process_file(fpath: str, fname: str):
        if fname not in seen and os.path.isfile(fpath) and not fname.startswith("."):
            size_mb = round(os.path.getsize(fpath) / (1024 * 1024), 2)
            page_count = get_pdf_page_count(fpath) if fname.lower().endswith(".pdf") else 1
            seen.add(fname)
            available_files.append({
                "filename": fname,
                "size_mb": size_mb,
                "pages": page_count,
                "indexed": fname in stats["files"],
                "status": "ready"
            })

    # 3. User local directory files
    user_uploads_dir = get_user_uploads_dir(user_id)
    if os.path.exists(user_uploads_dir):
        for fname in sorted(os.listdir(user_uploads_dir)):
            fpath = os.path.join(user_uploads_dir, fname)
            if os.path.isfile(fpath):
                process_file(fpath, fname)

    # 4. Guest / default workspace demo files
    if is_guest_or_default_user(user_id):
        base_uploads_dir = os.path.join(ROOT_DIR, "data", "uploaded_docs")
        if os.path.exists(base_uploads_dir) and base_uploads_dir != user_uploads_dir:
            for fname in sorted(os.listdir(base_uploads_dir)):
                fpath = os.path.join(base_uploads_dir, fname)
                if os.path.isfile(fpath):
                    process_file(fpath, fname)

        guest_sub = os.path.join(ROOT_DIR, "data", "uploaded_docs", DEFAULT_LOCAL_USER)
        if os.path.exists(guest_sub) and guest_sub != user_uploads_dir:
            for fname in sorted(os.listdir(guest_sub)):
                fpath = os.path.join(guest_sub, fname)
                if os.path.isfile(fpath):
                    process_file(fpath, fname)

    # 5. Add any remaining files that were indexed into vector DB for this user
    for fname in stats["files"]:
        # Filter out any internal guest-prefixed files
        if fname.startswith("guest_") and len(fname) > 25 and "_" in fname[6:]:
            continue
        if fname not in seen and not fname.startswith("."):
            seen.add(fname)
            fpath = resolve_document_path(fname, user_id=user_id)
            if fpath and os.path.exists(fpath) and os.path.isfile(fpath):
                size_mb = round(os.path.getsize(fpath) / (1024 * 1024), 2)
                page_count = get_pdf_page_count(fpath) if fname.lower().endswith(".pdf") else 1
            else:
                size_mb = 0.2
                page_count = 1
            available_files.append({
                "filename": fname,
                "size_mb": size_mb,
                "pages": page_count,
                "indexed": True,
                "status": "ready"
            })

    return {"documents": available_files}

@app.post("/api/upload")
async def upload_documents(files: list[UploadFile] = File(...), user_id: str = Depends(require_user)):
    """
    Upload and index multiple documents to Supabase Storage.
    
    - Supports PDF, Markdown, Text, and source code files
    - Validates file sizes (max 50MB per file)
    - Stores files in Supabase Storage (persists across redeployments)
    - Returns indexed documents with status
    """
    from src.supabase_storage import upload_bytes
    
    MAX_FILE_SIZE_MB = 50
    MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
    
    set_current_user(user_id)
    
    ingested_count = 0
    errors = []
    processing_times = []
    
    for file in files:
        try:
            filename = _validate_filename(file.filename or "unknown")
        except ValueError as e:
            errors.append(f"Invalid filename: {str(e)}")
            continue
        
        try:
            content = await file.read()
            
            # Validate file size
            if len(content) > MAX_FILE_SIZE_BYTES:
                errors.append(f"{filename}: File too large ({len(content) / (1024*1024):.1f}MB, max {MAX_FILE_SIZE_MB}MB)")
                continue
            
            if len(content) == 0:
                errors.append(f"{filename}: File is empty")
                continue
            
            file_start = time.time()
            
            # Upload to Supabase Storage (persists in cloud)
            supabase_path = f"users/{user_id}/{filename}"
            try:
                upload_bytes(content, supabase_path, bucket_name="documents")
            except Exception as e:
                print(f"[Upload] Storage notice for {filename}: {e}")

            # Save to user uploads dir
            user_dir = get_user_uploads_dir(user_id)
            os.makedirs(user_dir, exist_ok=True)
            save_path = os.path.join(user_dir, filename)
            with open(save_path, "wb") as f:
                f.write(content)
            
            # Register in Postgres database
            page_count = get_pdf_page_count(save_path) if filename.lower().endswith(".pdf") else 1
            try:
                from src.docs_db import upsert_document_record, update_document_status
                upsert_document_record(filename, user_id=user_id, size_bytes=len(content), page_count=page_count, status="ready")
            except Exception as dbe:
                print(f"[Upload] DocsDB notice: {dbe}")

            try:
                # Purge prior vectors for this filename to prevent duplicate accumulation
                delete_file_from_collection(filename, user_id=user_id)
                # Run optimized ingestion
                ingest_res = await asyncio.to_thread(
                    ingest_file,
                    save_path,
                    user_id=user_id,
                    file_bytes=content,
                    filename=filename,
                    extract_graph=False,
                    generate_ai_summary=False
                )
                ingested_count += 1
                elapsed = time.time() - file_start
                processing_times.append(elapsed)
                print(f"[Upload] ✓ Successfully ingested {filename} for user {user_id} in {elapsed:.2f}s")
                
                try:
                    update_document_status(
                        filename,
                        user_id=user_id,
                        status="ready",
                        chunk_count=ingest_res.get("chunk_count", 0) if isinstance(ingest_res, dict) else 0,
                        summary=ingest_res.get("summary") if isinstance(ingest_res, dict) else ""
                    )
                except Exception:
                    pass

                # Fire-and-forget background graph extraction
                _sp, _fn, _uid = save_path, filename, user_id
                async def _bg_graph(sp=_sp, fn=_fn, uid=_uid):
                    try:
                        await asyncio.to_thread(extract_graph_for_file, sp, fn, uid)
                    except Exception as ge:
                        print(f"[AutoGraph] Background graph extraction error for {fn}: {ge}")
                asyncio.create_task(_bg_graph())
            except Exception as e:
                print(f"[Upload Error] Error ingesting {filename}: {e}", flush=True)
                import traceback
                traceback.print_exc()
                errors.append(f"{filename}: {str(e)}")
        except Exception as e:
            errors.append(f"{file.filename}: {str(e)}")
    
    avg_time = sum(processing_times) / len(processing_times) if processing_times else 0
    if processing_times:
        print(f"[Upload] Batch complete: {ingested_count}/{len(files)} files, avg {avg_time:.2f}s per file")
            
    updated_docs = get_documents(user_id=user_id).get("documents", [])
    return {
        "success": ingested_count > 0 and len(errors) == 0,
        "ingested_count": ingested_count,
        "total_files": len(files),
        "errors": errors,
        "documents": updated_docs
    }

@app.post("/api/upload-stream")
async def upload_document_stream(file: UploadFile = File(...), user_id: str = Depends(require_user)):
    """
    Stream-based file upload with real-time progress feedback.
    Stores files in Supabase Storage for persistent access.
    
    Returns SSE stream with progress events:
    - type: "progress" | "done" | "error"
    - stage: "reading" | "chunking" | "embedding" | "indexing"
    - progress: 0-100
    - message: Human-readable status
    """
    from src.supabase_storage import upload_bytes
    
    MAX_FILE_SIZE_MB = 50
    MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
    
    set_current_user(user_id)
    
    try:
        filename = _validate_filename(file.filename or "unknown")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid filename: {str(e)}")
    
    try:
        content = await file.read()
        
        # Validate file size
        if len(content) > MAX_FILE_SIZE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"File too large ({len(content) / (1024*1024):.1f}MB, max {MAX_FILE_SIZE_MB}MB)"
            )
        
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="File is empty")
        
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=400, detail=f"Error reading file: {str(e)}")

    async def event_generator():
        """Generate SSE events for upload progress."""
        q = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def _progress_cb(stage: str, progress: int, message: str):
            """Callback from ingest_file to report progress."""
            try:
                loop.call_soon_threadsafe(
                    q.put_nowait,
                    {"type": "progress", "stage": stage, "progress": progress, "message": message, "filename": filename}
                )
            except Exception as e:
                print(f"[Upload-Stream] Error queuing progress: {e}")

        # Upload to Supabase Storage first (persists)
        supabase_path = f"users/{user_id}/{filename}"
        try:
            upload_bytes(content, supabase_path, bucket_name="documents")
            await q.put({"type": "progress", "stage": "storage", "progress": 3, "message": "Stored in Supabase", "filename": filename})
        except Exception as e:
            await q.put({"type": "error", "error": f"Failed to store file: {str(e)}", "filename": filename})
            yield json.dumps({"type": "error", "error": f"Failed to store file: {str(e)}", "filename": filename}) + "\n"
            return

        # Save to user uploads directory for persistent storage & instant inspection
        user_uploads_dir = get_user_uploads_dir(user_id)
        os.makedirs(user_uploads_dir, exist_ok=True)
        save_path = os.path.join(user_uploads_dir, filename)
        
        try:
            with open(save_path, "wb") as f:
                f.write(content)
        except Exception as e:
            await q.put({"type": "error", "error": f"Failed to save file: {str(e)}", "filename": filename})
            yield json.dumps({"type": "error", "error": f"Failed to save file: {str(e)}", "filename": filename}) + "\n"
            return

        # Register in PostgreSQL database
        page_count = get_pdf_page_count(save_path) if filename.lower().endswith(".pdf") else 1
        try:
            from src.docs_db import upsert_document_record
            upsert_document_record(filename, user_id=user_id, size_bytes=len(content), page_count=page_count, status="ready")
        except Exception as dbe:
            print(f"[Upload-Stream] DocsDB notice: {dbe}")

        # Purge prior vectors to prevent duplicates
        try:
            delete_file_from_collection(filename, user_id=user_id)
        except Exception as e:
            print(f"[Upload-Stream] Warning: Could not purge old vectors: {e}")

        await q.put({"type": "progress", "stage": "reading", "progress": 15, "message": "Extracting text content...", "filename": filename})

        async def _run_ingest():
            """Run ingestion in thread pool to not block event loop."""
            try:
                # Fast primary ingestion: chunking + FastEmbed dense vectors
                # Uses content bytes directly for instant in-memory processing
                ingest_res = await asyncio.to_thread(
                    ingest_file,
                    save_path,
                    user_id=user_id,
                    file_bytes=content,
                    filename=filename,
                    extract_graph=False,
                    generate_ai_summary=False,
                    on_progress=_progress_cb
                )
                try:
                    from src.docs_db import update_document_status
                    update_document_status(
                        filename,
                        user_id=user_id,
                        status="ready",
                        chunk_count=ingest_res.get("chunk_count", 0) if isinstance(ingest_res, dict) else 0,
                        summary=ingest_res.get("summary") if isinstance(ingest_res, dict) else ""
                    )
                except Exception:
                    pass
                await q.put({"type": "done", "success": True, "filename": filename})
            except Exception as e:
                import traceback
                print(f"[Upload-Stream] Ingestion error for {filename}: {e}")
                traceback.print_exc()
                await q.put({"type": "error", "error": str(e), "filename": filename})

        ingest_task = asyncio.create_task(_run_ingest())

        # Stream events from queue until completion
        while True:
            try:
                item = await asyncio.wait_for(q.get(), timeout=300)  # 5 minute timeout
                yield json.dumps(item) + "\n"
                
                if item.get("type") in ("done", "error"):
                    # Fire-and-forget background graph extraction after successful upload
                    if item.get("type") == "done":
                        async def _bg_graph():
                            try:
                                await asyncio.to_thread(extract_graph_for_file, save_path, filename, user_id)
                                print(f"[AutoGraph] ✓ Completed background extraction for {filename}")
                            except Exception as ge:
                                print(f"[AutoGraph] Background extraction error for {filename}: {ge}")
                        asyncio.create_task(_bg_graph())
                    break
            except asyncio.TimeoutError:
                await q.put({"type": "error", "error": "Upload timeout - file processing took too long", "filename": filename})
                yield json.dumps({"type": "error", "error": "Upload timeout", "filename": filename}) + "\n"
                break

        await ingest_task

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")

def _delete_physical_file(filename: str, user_id: str | None = None):
    try:
        safe_name = _validate_filename(filename)
    except ValueError:
        return
    
    from src.config import UPLOADS_DIR, ROOT_DIR
    target_dirs = [
        os.path.join(UPLOADS_DIR, _validate_user_id(user_id)),
        os.path.join(UPLOADS_DIR, "default"),
        os.path.join(UPLOADS_DIR, DEFAULT_LOCAL_USER),
        UPLOADS_DIR,
        os.path.join(ROOT_DIR, "data"),
    ]
    resolved = resolve_document_path(filename, user_id=user_id)
    if resolved:
        target_dirs.append(os.path.dirname(resolved))
    
    for d in set(target_dirs):
        p = os.path.join(d, safe_name)
        if os.path.exists(p) and os.path.isfile(p):
            try:
                os.remove(p)
                print(f"[API] Removed physical file: {p}")
            except Exception as e:
                print(f"[API] Error removing physical file {p}: {e}")

def _delete_storage_file(filename: str, user_id: str | None = None):
    try:
        safe_name = _validate_filename(filename)
        from src.supabase_storage import delete_file
        delete_file(f"users/{user_id}/{safe_name}")
        if is_guest_or_default_user(user_id):
            delete_file(f"users/{DEFAULT_LOCAL_USER}/{safe_name}")
            delete_file(f"users/default/{safe_name}")
    except Exception:
        pass

def _delete_graph_file(filename: str, user_id: str | None = None):
    try:
        from src.graph_db import delete_document_graph
        delete_document_graph(filename, user_id=user_id)
    except Exception:
        pass

@app.delete("/api/documents/{filename}")
def delete_document(filename: str, user_id: str = Depends(require_user)):
    set_current_user(user_id)
    _delete_physical_file(filename, user_id=user_id)
    delete_file_from_collection(filename, user_id=user_id)
    _delete_storage_file(filename, user_id=user_id)
    
    try:
        from src.docs_db import delete_document_record
        delete_document_record(filename, user_id=user_id)
    except Exception as e:
        print(f"[API] Error deleting docs_db record: {e}")
        
    _delete_graph_file(filename, user_id=user_id)
    return {"success": True, "filename": filename}

class BatchDeleteRequest(BaseModel):
    filenames: List[str]

@app.post("/api/documents/batch-delete")
def batch_delete_documents(req: BatchDeleteRequest, user_id: str = Depends(require_user)):
    set_current_user(user_id)
    filenames = req.filenames
    if not filenames:
        return {"success": True, "deleted": []}
    
    for fn in filenames:
        _delete_physical_file(fn, user_id=user_id)
        _delete_storage_file(fn, user_id=user_id)
        _delete_graph_file(fn, user_id=user_id)
        
    delete_files_from_collection(filenames, user_id=user_id)
    
    try:
        from src.docs_db import delete_document_records
        delete_document_records(filenames, user_id=user_id)
    except Exception as e:
        print(f"[API] Error deleting docs_db records batch: {e}")
        
    return {"success": True, "deleted": filenames}

@app.get("/api/download/{filename}")
def download_document(filename: str, user_id: str = Depends(require_user)):
    file_path = resolve_document_path(filename, user_id=user_id)
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path, filename=os.path.basename(file_path))

@app.post("/api/documents/{filename}/reindex")
def reindex_document(filename: str, user_id: str = Depends(require_user)):
    set_current_user(user_id)
    file_path = resolve_document_path(filename, user_id=user_id)
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    try:
        delete_file_from_collection(filename, user_id=user_id)
        ingest_file(file_path, user_id=user_id)
        return {"success": True, "filename": filename}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error re-indexing {filename}: {e}")

@app.post("/api/documents/{filename}/enhance")
async def enhance_document(
    filename: str, 
    user_id: str = Depends(require_user),
    extract_graph: bool = Query(default=True, description="Extract knowledge graph"),
    generate_summary: bool = Query(default=True, description="Generate AI summary")
):
    """
    Enhance an already-indexed document with optional features:
    - Knowledge graph extraction (entities, relations, communities)
    - AI-generated summary
    
    This is useful for documents uploaded with fast mode that need full features.
    """
    set_current_user(user_id)
    file_path = resolve_document_path(filename, user_id=user_id)
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    
    try:
        print(f"[Enhance] Enhancing {filename} with graph={extract_graph}, summary={generate_summary}")
        start_time = time.time()
        
        # Run enhancement in thread to not block event loop
        await asyncio.to_thread(
            ingest_file, 
            file_path, 
            user_id,
            extract_graph=extract_graph,
            generate_ai_summary=generate_summary
        )
        
        elapsed = time.time() - start_time
        print(f"[Enhance] ✓ Enhanced {filename} in {elapsed:.2f}s")
        
        return {
            "success": True, 
            "filename": filename,
            "processing_time": round(elapsed, 2),
            "features_enabled": {
                "knowledge_graph": extract_graph,
                "ai_summary": generate_summary
            }
        }
    except Exception as e:
        print(f"[Enhance Error] {filename}: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error enhancing {filename}: {str(e)}")

@app.post("/api/documents/batch-enhance")
async def batch_enhance_documents(
    filenames: list[str],
    user_id: str = Depends(require_user),
    extract_graph: bool = Query(default=True),
    generate_summary: bool = Query(default=True)
):
    """
    Enhance multiple documents in batch.
    Useful for adding features to all documents after bulk upload.
    """
    set_current_user(user_id)
    
    results = []
    total_start = time.time()
    
    for filename in filenames:
        file_path = resolve_document_path(filename, user_id=user_id)
        if not file_path or not os.path.exists(file_path):
            results.append({"filename": filename, "success": False, "error": "File not found"})
            continue
        
        try:
            file_start = time.time()
            await asyncio.to_thread(
                ingest_file,
                file_path,
                user_id,
                extract_graph=extract_graph,
                generate_ai_summary=generate_summary
            )
            elapsed = time.time() - file_start
            results.append({
                "filename": filename,
                "success": True,
                "processing_time": round(elapsed, 2)
            })
            print(f"[Batch Enhance] ✓ {filename} enhanced in {elapsed:.2f}s")
        except Exception as e:
            results.append({
                "filename": filename,
                "success": False,
                "error": str(e)
            })
            print(f"[Batch Enhance] ✗ {filename} failed: {e}")
    
    total_elapsed = time.time() - total_start
    success_count = sum(1 for r in results if r["success"])
    
    print(f"[Batch Enhance] Complete: {success_count}/{len(filenames)} files in {total_elapsed:.2f}s")
    
    return {
        "success": success_count > 0,
        "total_files": len(filenames),
        "successful": success_count,
        "failed": len(filenames) - success_count,
        "total_time": round(total_elapsed, 2),
        "results": results
    }

@app.post("/api/github/preview")
def preview_github(data: dict, user_id: str = Depends(require_user)):
    set_current_user(user_id)
    repo_input = (data.get("repo") or data.get("repo_url") or "").strip()
    branch = (data.get("branch") or "").strip() or None
    token = (data.get("token") or "").strip() or None
    subfolder = (data.get("subfolder") or "").strip() or None
    extensions = data.get("extensions")
    
    if not repo_input:
        raise HTTPException(status_code=400, detail="Repository URL or 'owner/repo' is required.")
        
    try:
        from src.github_connector import parse_github_repo_url, fetch_repo_tree
        owner, repo = parse_github_repo_url(repo_input)
        tree_res = fetch_repo_tree(
            owner=owner,
            repo=repo,
            branch=branch,
            token=token,
            subfolder=subfolder,
            extensions=extensions,
            max_files=150
        )
        return tree_res
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to inspect GitHub repository: {str(e)}")

@app.post("/api/github/sync")
async def sync_github(data: dict, user_id: str = Depends(require_user)):
    set_current_user(user_id)
    repo_input = (data.get("repo") or data.get("repo_url") or "").strip()
    branch = (data.get("branch") or "").strip() or "main"
    token = (data.get("token") or "").strip() or None
    selected_files = data.get("files") or data.get("selected_paths")
    subfolder = (data.get("subfolder") or "").strip() or None
    extensions = data.get("extensions")
    
    if not repo_input:
        raise HTTPException(status_code=400, detail="Repository URL or 'owner/repo' is required.")
        
    try:
        from src.github_connector import parse_github_repo_url, sync_github_files
        owner, repo = parse_github_repo_url(repo_input)
        
        result = await asyncio.to_thread(
            sync_github_files,
            owner=owner,
            repo=repo,
            branch=branch,
            selected_paths=selected_files,
            token=token,
            subfolder=subfolder,
            extensions=extensions,
            user_id=user_id,
            max_files=150
        )
        return result
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to synchronize GitHub repository: {str(e)}")

@app.post("/api/github/sync-stream")
async def sync_github_stream(data: dict, user_id: str = Depends(require_user)):
    set_current_user(user_id)
    repo_input = (data.get("repo") or data.get("repo_url") or "").strip()
    branch = (data.get("branch") or "").strip() or "main"
    token = (data.get("token") or "").strip() or None
    selected_files = data.get("files") or data.get("selected_paths")
    subfolder = (data.get("subfolder") or "").strip() or None
    extensions = data.get("extensions")
    
    if not repo_input:
        raise HTTPException(status_code=400, detail="Repository URL or 'owner/repo' is required.")
        
    try:
        from src.github_connector import parse_github_repo_url, sync_github_files_stream
        owner, repo = parse_github_repo_url(repo_input)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    async def event_generator():
        loop = asyncio.get_running_loop()
        gen = sync_github_files_stream(
            owner=owner,
            repo=repo,
            branch=branch,
            selected_paths=selected_files,
            token=token,
            subfolder=subfolder,
            extensions=extensions,
            user_id=user_id,
            max_files=150
        )
        
        def _get_next():
            try:
                return next(gen), False
            except StopIteration:
                return None, True

        while True:
            try:
                item, is_done = await loop.run_in_executor(None, _get_next)
                if is_done:
                    break
                yield json.dumps(item) + "\n"
            except Exception as loop_err:
                yield json.dumps({"type": "error", "error": str(loop_err)}) + "\n"
                break

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")

@app.get("/api/pdf-info")
def get_pdf_info(filename: str = Query(...), user_id: str = Depends(require_user)):
    file_path = resolve_document_path(filename, user_id=user_id)
    if not file_path or not os.path.exists(file_path):
        return {"filename": filename, "total_pages": 1}
    count = get_pdf_page_count(file_path)
    return {"filename": filename, "total_pages": count or 1}

@app.get("/api/file-content")
def get_file_content(filename: str = Query(...), user_id: str = Depends(require_user)):
    file_path = resolve_document_path(filename, user_id=user_id)
    if not file_path or not os.path.exists(file_path):
        return {"filename": filename, "content": "File content unavailable."}
    
    if filename.lower().endswith(".pdf"):
        from src.pdf_viewer import extract_pdf_page_text
        try:
            pages_text = []
            for p_num in range(1, 4):
                t = extract_pdf_page_text(file_path, p_num)
                if t and not t.startswith("Error"):
                    pages_text.append(t.strip())
            content = "\n\n---\n\n".join(pages_text) if pages_text else "No text extracted from PDF."
            return {"filename": filename, "content": content}
        except Exception as pe:
            return {"filename": filename, "content": f"PDF extraction note: {str(pe)}"}

    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        return {"filename": filename, "content": content}
    except Exception as e:
        return {"filename": filename, "content": f"Error reading file: {str(e)}"}

@app.get("/api/pdf-page-image")
def get_pdf_page_image(filename: str = Query(...), page: int = Query(1, ge=1), user_id: str = Depends(require_user)):
    file_path = resolve_document_path(filename, user_id=user_id)
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
        
    img_bytes = render_pdf_page_image(file_path, page_num=page, dpi=150)
    if not img_bytes:
        raise HTTPException(status_code=500, detail="Failed to render PDF page image")
    return Response(content=img_bytes, media_type="image/png")


@app.get("/api/sessions")
def get_sessions(user_id: str = Depends(require_user)):
    set_current_user(user_id)
    sessions = get_all_sessions(user_id=user_id)
    return {"sessions": sessions}

@app.post("/api/sessions")
def create_new_session(data: dict = Body(default={}), user_id: str = Depends(require_user)):
    set_current_user(user_id)
    title = data.get("title", "New Chat") if isinstance(data, dict) else "New Chat"
    session_id = data.get("session_id") if isinstance(data, dict) else None
    real_id = create_session(title=title, user_id=user_id, session_id=session_id)
    return {"session_id": real_id, "title": title}

@app.get("/api/sessions/{session_id}/messages")
def get_messages(session_id: str):
    messages = get_session_messages(session_id)
    return {"messages": messages}

@app.delete("/api/sessions/{session_id}")
def delete_chat_session(session_id: str):
    delete_session(session_id)
    return {"success": True}

@app.post("/api/reset")
def reset_all(user_id: str = Depends(require_user)):
    set_current_user(user_id)
    clear_collection()
    try:
        from src.graph_db import clear_user_graph
        clear_user_graph(user_id=user_id)
    except Exception:
        pass
    sessions = get_all_sessions(user_id=user_id)
    for s in sessions:
        delete_session(s["session_id"])
    new_id = create_session("New Chat", user_id=user_id)
    return {"success": True, "new_session_id": new_id}

@app.post("/api/chat/stream")
def stream_chat(data: dict, user_id: str = Depends(require_user)):
    set_current_user(user_id)
    session_id = data.get("session_id")
    prompt = data.get("prompt")
    model = data.get("model")
    custom_instructions = data.get("custom_instructions")
    web_search = bool(data.get("web_search", False))
    
    if not session_id or not prompt:
        raise HTTPException(status_code=400, detail="Missing session_id or prompt")
        
    def sse_event_generator():
        try:
            status_msg = "Searching vault & live web via Tavily..." if web_search else "Searching knowledge vault..."
            yield f"data: {json.dumps({'type': 'status', 'message': status_msg})}\n\n"

            # Fetch session history and record user message non-blockingly
            try:
                save_message_async(session_id, "user", prompt)
                messages = get_session_messages(session_id)
            except Exception as hist_err:
                print(f"[Warning] Chat history notice: {hist_err}", flush=True)
                messages = []

            try:
                prompt_str, retrieved_contexts = prepare_context_and_prompt(
                    prompt, 
                    messages, 
                    user_id=user_id,
                    custom_instructions=custom_instructions,
                    web_search=web_search
                )
            except Exception as prep_err:
                print(f"[Warning] Context preparation notice: {prep_err}", flush=True)
                prompt_str = prompt
                retrieved_contexts = []

            yield f"data: {json.dumps({'type': 'contexts', 'contexts': retrieved_contexts})}\n\n"
            
            full_text = ""
            stream_gen = answer_query_stream(prompt, messages, model=model, prepared_prompt=prompt_str, user_id=user_id)
            for token in stream_gen:
                full_text += token
                yield f"data: {json.dumps({'type': 'token', 'token': token})}\n\n"
                
            try:
                save_message_async(session_id, "assistant", full_text, retrieved_contexts)
            except Exception as save_err:
                print(f"[Warning] Failed to save assistant message: {save_err}", flush=True)

            yield f"data: {json.dumps({'type': 'done', 'full_text': full_text})}\n\n"
        except Exception as e:
            print(f"[Error] Stream generation error: {e}", flush=True)
            import traceback
            traceback.print_exc()
            err_msg = f"\n\n⚠️ *Backend Stream Error: {str(e)}*"
            yield f"data: {json.dumps({'type': 'token', 'token': err_msg})}\n\n"
            yield f"data: {json.dumps({'type': 'done', 'full_text': err_msg})}\n\n"
            
    return StreamingResponse(
        sse_event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


# ==========================================
# KNOWLEDGE GRAPH & COMMUNITY ENDPOINTS
# ==========================================

@app.get("/api/graph")
def get_graph(response: Response = None, user_id: str = Depends(require_user)):
    """Fetch complete Knowledge Graph (nodes, links, communities, metrics). Always dynamic and synced with current vault."""
    if response:
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    set_current_user(user_id)
    try:
        from src.graph_db import get_user_graph, sync_and_prune_graph
        
        # 1. Fetch current active filenames from Knowledge Vault
        vault_docs = get_documents(user_id=user_id).get("documents", [])
        active_filenames = [d["filename"] for d in vault_docs if d.get("filename")]
        
        # 2. Prune obsolete or deleted document graph entries
        sync_and_prune_graph(user_id=user_id, active_filenames=active_filenames)
        
        # 3. Return fresh graph strictly scoped to current vault documents
        return get_user_graph(user_id=user_id, active_filenames=active_filenames)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch knowledge graph: {exc}")


@app.post("/api/graph/build")
def build_graph(
    background_tasks: BackgroundTasks,
    force_rebuild: bool = Query(True, description="Force complete graph rebuild"),
    user_id: str = Depends(require_user),
):
    """Triggers background knowledge graph construction across active vault documents."""
    set_current_user(user_id)
    def graph_worker(force: bool, uid: str):
        try:
            from src.graph_db import clear_user_graph, run_entity_resolution_and_deduplication
            from src.graph_extractor import extract_entities_and_relations
            from src.graph_clustering import run_community_detection_and_summaries

            if force:
                clear_user_graph(user_id=uid)

            # Retrieve only currently existing files in the Knowledge Vault
            vault_docs = get_documents(user_id=uid).get("documents", [])
            doc_files = []
            for vd in vault_docs:
                fn = vd["filename"]
                p = resolve_document_path(fn, user_id=uid)
                if p and os.path.exists(p):
                    doc_files.append((p, fn))

            for path, filename in doc_files:
                try:
                    if filename.lower().endswith('.pdf'):
                        import fitz
                        doc = fitz.open(path)
                        for page_num in range(min(len(doc), 6)):
                            text = doc[page_num].get_text()
                            if text and len(text.strip()) > 50:
                                extract_entities_and_relations(text, filename, page_num + 1, user_id=uid)
                        doc.close()
                    else:
                        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                            text = f.read()
                        if text and len(text.strip()) > 50:
                            extract_entities_and_relations(text[:5000], filename, 1, user_id=uid)
                except Exception as doc_exc:
                    print(f"[GraphWorker] Error extracting from {filename}: {doc_exc}")

            run_entity_resolution_and_deduplication(user_id=uid)
            run_community_detection_and_summaries(user_id=uid)
            print(f"[GraphWorker] Completed graph build across {len(doc_files)} vault files for user {uid}.")
        except Exception as exc:
            print(f"[GraphWorker] Error during graph build: {exc}")

    background_tasks.add_task(graph_worker, force_rebuild, user_id)
    return {"status": "accepted", "message": "Knowledge graph build task scheduled"}


@app.get("/api/graph/communities")
def get_graph_communities(user_id: str = Depends(require_user)):
    """Fetch hierarchical community summaries."""
    set_current_user(user_id)
    try:
        from src.graph_db import get_user_graph
        graph_data = get_user_graph(user_id=user_id)
        return {
            "communities": graph_data.get("communities", []),
            "total": len(graph_data.get("communities", [])),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch communities: {exc}")


@app.post("/api/graph/update-communities")
def update_communities(user_id: str = Depends(require_user)):
    """Manually trigger community detection and clustering on existing graph data."""
    set_current_user(user_id)
    try:
        from src.graph_clustering import run_community_detection_and_summaries
        from src.graph_db import get_user_graph
        result = run_community_detection_and_summaries(user_id=user_id)
        graph_data = get_user_graph(user_id=user_id)
        return {
            "success": True,
            "message": "Community detection completed",
            "communities_updated": len(graph_data.get("communities", [])),
            "result": result,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to update communities: {exc}")


