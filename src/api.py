import os
import sys
import json
import shutil
import tempfile
import asyncio
import uuid
import time
from typing import Optional, Dict
from fastapi import FastAPI, File, UploadFile, Query, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response, JSONResponse, FileResponse

# --- PATH RESOLUTION ---
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

try:
    from src.db import init_db, clear_collection, get_collection_stats, delete_file_from_collection, get_qdrant_client
    from src.ingest import ingest_file
    from src.generate import answer_query_stream, answer_query_stream_with_prompt, prepare_context_and_prompt
    from src.chat_db import init_chat_db, create_session, get_all_sessions, add_message, get_session_messages, delete_session
    from src.pdf_viewer import render_pdf_page_image, get_pdf_page_count, extract_pdf_page_text
    from src.auth import require_user, set_current_user, get_current_user
    from src.state_db import init_state_db, upsert_document, save_upload_job, get_upload_job, delete_document_record, save_feedback
    from src.storage import save_file, get_file_bytes, delete_file
    from src.audio import transcribe_audio
except ImportError:
    from db import init_db, clear_collection, get_collection_stats, delete_file_from_collection, get_qdrant_client
    from ingest import ingest_file
    from generate import answer_query_stream, answer_query_stream_with_prompt, prepare_context_and_prompt
    from chat_db import init_chat_db, create_session, get_all_sessions, add_message, get_session_messages, delete_session
    from pdf_viewer import render_pdf_page_image, get_pdf_page_count, extract_pdf_page_text
    from auth import require_user, set_current_user, get_current_user
    from state_db import init_state_db, upsert_document, save_upload_job, get_upload_job, delete_document_record, save_feedback
    from storage import save_file, get_file_bytes, delete_file
    from audio import transcribe_audio

def get_uploads_dir() -> str:
    candidate = os.getenv("UPLOADS_DIR")
    if candidate:
        try:
            os.makedirs(candidate, exist_ok=True)
            test_file = os.path.join(candidate, ".perm_test")
            with open(test_file, "w") as f:
                f.write("ok")
            os.remove(test_file)
            return candidate
        except (PermissionError, OSError) as exc:
            print(f"[Warning] Configured UPLOADS_DIR '{candidate}' is not accessible ({exc}). Falling back to local storage.")
    fallback = os.path.join(ROOT_DIR, "data", "uploaded_docs")
    try:
        os.makedirs(fallback, exist_ok=True)
        return fallback
    except (PermissionError, OSError):
        temp_dir = os.path.join(tempfile.gettempdir(), "uploaded_docs")
        os.makedirs(temp_dir, exist_ok=True)
        return temp_dir

# Set UPLOADS_DIR with fallback
UPLOADS_DIR = get_uploads_dir()

app = FastAPI(
    title="Enterprise Multi-Document RAG API",
    description="Commercial REST API for Agentic RAG with Groq LPUs, Cross-Encoder Reranking, and PyMuPDF.",
    version="2.0.0"
)

# Rate limiter setup
try:
    from slowapi import Limiter, _rate_limit_exceeded_handler
    from slowapi.util import get_remote_address
    from slowapi.errors import RateLimitExceeded

    limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
except Exception:
    class DummyLimiter:
        def limit(self, *args, **kwargs):
            return lambda fn: fn
    limiter = DummyLimiter()

# CORS middleware for Web Frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("CORS_ORIGINS", "*").split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def logging_and_auth_middleware(request: Request, call_next):
    start_time = time.perf_counter()
    user_id = None
    
    # Public route bypass
    if request.method == "OPTIONS" or request.url.path in ("/", "/api/health", "/docs", "/redoc", "/openapi.json"):
        response = await call_next(request)
        latency = round((time.perf_counter() - start_time) * 1000, 1)
        return response

    # Authenticate API requests
    if request.url.path.startswith("/api/"):
        try:
            user_id = require_user(request.headers.get("authorization"))
            set_current_user(user_id)
        except HTTPException as exc:
            return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
        except Exception as exc:
            return JSONResponse(status_code=401, content={"detail": "Authentication required"})

    response = await call_next(request)
    latency_ms = round((time.perf_counter() - start_time) * 1000, 1)
    if not request.url.path.startswith("/api/health"):
        print(f"[HTTP] {request.method} {request.url.path} -> {response.status_code} ({latency_ms}ms) user={user_id or 'anon'}")
    return response

@app.get("/")
def root():
    """Root endpoint for health checks and service uptime monitors."""
    return {
        "name": "Enterprise Multi-Document RAG API",
        "status": "online",
        "version": "2.0.0",
        "health": "/api/health",
        "docs": "/docs"
    }

def user_upload_dir() -> str:
    path = os.path.join(get_uploads_dir(), get_current_user())
    os.makedirs(path, exist_ok=True)
    return path

def safe_filename(filename: str) -> str:
    name = os.path.basename(filename)
    if not name or name != filename or name in {".", ".."}:
        raise HTTPException(status_code=400, detail="Invalid filename")
    return name

# Global progress tracking for uploads
upload_progress: Dict[str, Dict] = {}


@app.on_event("startup")
def startup_event():
    init_db()
    init_chat_db()
    init_state_db()

@app.get("/api/health")
def health_check():
    """Run readiness checks against the services used by the RAG pipeline."""
    checks = {}

    def run_check(name, check):
        started = time.perf_counter()
        try:
            details = check() or {}
            checks[name] = {"status": "healthy", "latency_ms": round((time.perf_counter() - started) * 1000, 1), **details}
        except Exception as exc:
            checks[name] = {"status": "unhealthy", "latency_ms": round((time.perf_counter() - started) * 1000, 1), "error": str(exc)}

    def check_qdrant():
        client = get_qdrant_client()
        collection = client.get_collection(collection_name=os.getenv("COLLECTION_NAME", "pdf_chunks"))
        payload_schema = getattr(collection, "payload_schema", {}) or {}
        if "metadata.filename" not in payload_schema:
            raise RuntimeError("Required keyword index metadata.filename is missing")
        return {
            "collection": os.getenv("COLLECTION_NAME", "pdf_chunks"),
            "points": getattr(collection, "points_count", 0),
            "filename_index_ready": True,
        }

    def check_upload_storage():
        active_dir = get_uploads_dir()
        with tempfile.NamedTemporaryFile(dir=active_dir, prefix=".health-", delete=True) as probe:
            probe.write(b"ok")
            probe.flush()
        return {
            "path": active_dir,
            "writable": True,
            "persistence": "persistent" if os.getenv("UPLOADS_DIR") == active_dir else "ephemeral",
        }

    # Every check touches the real dependency used by an upload/chat request;
    # this is deliberately more than a process-alive probe.
    run_check("qdrant", check_qdrant)
    run_check("upload_storage", check_upload_storage)
    run_check("chat_database", lambda: (init_chat_db(), {"available": True})[1])
    checks["groq"] = {
        "status": "healthy" if os.getenv("GROQ_API_KEY") else "unhealthy",
        "configured": bool(os.getenv("GROQ_API_KEY")),
    }

    required = ("qdrant", "upload_storage", "chat_database", "groq")
    is_ready = all(checks[name]["status"] == "healthy" for name in required)
    # A writable default directory works, but Render will erase it on restart.
    storage_warning = checks["upload_storage"].get("persistence") == "ephemeral"
    status = "healthy" if is_ready and not storage_warning else "degraded" if is_ready else "unhealthy"
    return JSONResponse(
        status_code=200 if is_ready else 503,
        content={
            "status": status,
            "ready": is_ready,
            "version": "2.0.0",
            "checks": checks,
        },
    )

@app.get("/api/upload-progress/{upload_id}")
def get_upload_progress(upload_id: str):
    """Get real-time progress for a specific upload session."""
    persisted = get_upload_job(upload_id, get_current_user())
    if persisted:
        return dict(persisted)
    if upload_id not in upload_progress:
        return {"upload_id": upload_id, "status": "not_found", "files": []}
    
    progress = upload_progress[upload_id]
    if progress.get("user_id") != get_current_user():
        raise HTTPException(status_code=404, detail="Upload not found")
    return progress

@app.get("/api/stats")
def get_stats():
    stats = get_collection_stats()
    sessions = get_all_sessions()
    
    # Check filesystem vs Qdrant discrepancy
    uploads_dir = user_upload_dir()
    files_on_disk = []
    if os.path.exists(uploads_dir):
        files_on_disk = [f for f in os.listdir(uploads_dir) if os.path.isfile(os.path.join(uploads_dir, f))]
    
    print(f"[DEBUG] Stats - Qdrant files: {stats['files']}, Disk files: {files_on_disk}")
    
    return {
        "status": "Active",
        "total_chunks": stats["total_chunks"],
        "files_count": len(stats["files"]),
        "files": stats["files"],
        "disk_files": files_on_disk,
        "sessions_count": len(sessions)
    }

@app.get("/api/documents")
def list_documents():
    """List indexed documents even when Render's ephemeral disk was reset."""
    stats = get_collection_stats()
    uploads_dir = user_upload_dir()
    available_files = []
    
    print(f"[DEBUG] Uploads directory: {uploads_dir}")
    print(f"[DEBUG] Directory exists: {os.path.exists(uploads_dir)}")
    print(f"[DEBUG] Files in Qdrant: {stats['files']}")
    
    os.makedirs(uploads_dir, exist_ok=True)
    files_on_disk = {
        fname for fname in os.listdir(uploads_dir)
        if os.path.isfile(os.path.join(uploads_dir, fname))
    }
    print(f"[DEBUG] Files on disk: {sorted(files_on_disk)}")

    # Qdrant is the durable source of truth for indexed documents.  The local
    # disk only augments records with original-file details when it is present.
    all_filenames = sorted(set(stats["files"]) | files_on_disk)
    for fname in all_filenames:
        fpath = os.path.join(uploads_dir, fname)
        local_file_exists = fname in files_on_disk
        details = stats.get("file_details", {}).get(fname, {})
        available_files.append({
            "filename": fname,
            "size_mb": round(os.path.getsize(fpath) / (1024 * 1024), 2) if local_file_exists else 0,
            "pages": (
                get_pdf_page_count(fpath) if local_file_exists and fname.lower().endswith(".pdf")
                else details.get("pages", 1)
            ),
            "indexed": fname in stats["files"],
            "source_file_available": local_file_exists,
        })
    
    print(f"[DEBUG] Returning {len(available_files)} available files")
    return {"documents": available_files}

MAX_FILE_SIZE_BYTES = 35 * 1024 * 1024  # 35 MB
MAX_FILES_PER_BATCH = 10
ALLOWED_EXTENSIONS = {".pdf", ".txt", ".md"}

def process_upload_batch_sync(upload_id: str, user_id: str, file_records: list[dict]):
    """Background worker that ingests files and updates progress in database."""
    set_current_user(user_id)
    completed = 0
    errors = []
    
    for idx, rec in enumerate(file_records):
        fname = rec["filename"]
        fpath = rec["path"]
        fsize = rec["size_bytes"]
        
        try:
            ingest_file(fpath, user_id)
            upsert_document(user_id, fname, "indexed", size_bytes=fsize)
            completed += 1
            rec["status"] = "completed"
            rec["progress"] = 100
            rec["indexed"] = True
        except Exception as exc:
            rec["status"] = "failed"
            rec["error"] = str(exc)
            errors.append(f"{fname}: {exc}")
            upsert_document(user_id, fname, "failed", size_bytes=fsize, error=str(exc))
            
        upload_progress[upload_id]["files"] = file_records
        upload_progress[upload_id]["completed_files"] = completed
        save_upload_job(upload_id, user_id, "uploading", len(file_records), completed, file_records)
        
    final_status = "completed" if completed > 0 else "failed"
    upload_progress[upload_id]["status"] = final_status
    save_upload_job(upload_id, user_id, final_status, len(file_records), completed, file_records)

@app.post("/api/upload", status_code=202)
@limiter.limit("20/minute")
async def upload_documents(
    request: Request,
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...)
):
    if len(files) > MAX_FILES_PER_BATCH:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_FILES_PER_BATCH} files allowed per upload.")
        
    uploads_dir = user_upload_dir()
    os.makedirs(uploads_dir, exist_ok=True)
    user_id = get_current_user()
    
    upload_id = str(uuid.uuid4())
    file_records = []
    
    for file in files:
        filename = safe_filename(file.filename or "")
        ext = os.path.splitext(filename)[1].lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(status_code=400, detail=f"Unsupported file format '{ext}'. Only PDF, TXT, and MD are allowed.")
            
        content = await file.read()
        file_size = len(content)
        if file_size > MAX_FILE_SIZE_BYTES:
            raise HTTPException(status_code=400, detail=f"File '{filename}' exceeds maximum allowed size of 35MB.")
            
        save_path = os.path.join(uploads_dir, filename)
        save_file(user_id, filename, content, local_path=save_path)
        upsert_document(user_id, filename, "processing", size_bytes=file_size)
        
        file_records.append({
            "filename": filename,
            "path": save_path,
            "size_bytes": file_size,
            "size_mb": round(file_size / (1024 * 1024), 2),
            "status": "processing",
            "progress": 25,
            "indexed": False
        })
        
    upload_progress[upload_id] = {
        "user_id": user_id,
        "upload_id": upload_id,
        "status": "processing",
        "total_files": len(files),
        "completed_files": 0,
        "files": file_records
    }
    save_upload_job(upload_id, user_id, "processing", len(files), 0, file_records)
    
    # Spawn non-blocking background ingestion worker
    background_tasks.add_task(process_upload_batch_sync, upload_id, user_id, file_records)
    
    return {
        "success": True,
        "upload_id": upload_id,
        "status": "processing",
        "files_count": len(files)
    }

@app.post("/api/audio/transcribe")
@limiter.limit("30/minute")
async def transcribe_audio_endpoint(request: Request, file: UploadFile = File(...)):
    """Transcribes audio using Groq Whisper LPU endpoint."""
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty audio recording")
    try:
        text = transcribe_audio(content, filename=file.filename or "audio.webm")
        return {"success": True, "text": text}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Transcription error: {exc}")

@app.post("/api/feedback")
def submit_feedback(data: dict):
    """Saves user rating and qualitative feedback for RAG evaluation."""
    session_id = data.get("session_id")
    message_id = data.get("message_id")
    rating = bool(data.get("rating", True))
    feedback = data.get("feedback")
    
    feedback_id = save_feedback(
        user_id=get_current_user(),
        session_id=session_id,
        message_id=message_id,
        rating=rating,
        feedback=feedback
    )
    return {"success": True, "feedback_id": feedback_id}

@app.delete("/api/documents/{filename}")
def delete_document(filename: str):
    uploads_dir = user_upload_dir()
    filename = safe_filename(filename)
    file_path = os.path.join(uploads_dir, filename)
    
    # Delete Qdrant first.  If the remote operation fails, retain the source
    # file so the user can retry instead of losing the only re-indexable copy.
    try:
        delete_file_from_collection(filename)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not delete vectors from Qdrant: {exc}")

    # Delete from local cache and Cloudflare R2
    delete_file(get_current_user(), filename, local_path=file_path)

    # Clean up PostgreSQL document state
    try:
        delete_document_record(get_current_user(), filename)
    except Exception as exc:
        print(f"[Warning] Could not delete document record from DB: {exc}")

    return {"success": True, "filename": filename}

@app.get("/api/download/{filename}")
def download_document(filename: str):
    uploads_dir = user_upload_dir()
    filename = safe_filename(filename)
    file_path = os.path.join(uploads_dir, filename)
    file_bytes = get_file_bytes(get_current_user(), filename, local_path=file_path)
    if not file_bytes:
        raise HTTPException(status_code=404, detail="File not found")
    return Response(
        content=file_bytes,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

@app.post("/api/documents/{filename}/reindex")
def reindex_document(filename: str):
    uploads_dir = user_upload_dir()
    filename = safe_filename(filename)
    file_path = os.path.join(uploads_dir, filename)
    if not os.path.exists(file_path):
        data = get_file_bytes(get_current_user(), filename, local_path=file_path)
        if not data:
            raise HTTPException(status_code=404, detail="File not found")
    try:
        delete_file_from_collection(filename)
        ingest_file(file_path, get_current_user())
        return {"success": True, "filename": filename}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error re-indexing {filename}: {e}")

@app.get("/api/pdf-info")
def get_pdf_info(filename: str = Query(...)):
    uploads_dir = user_upload_dir()
    filename = safe_filename(filename)
    file_path = os.path.join(uploads_dir, filename)
    if not os.path.exists(file_path):
        get_file_bytes(get_current_user(), filename, local_path=file_path)
    if not os.path.exists(file_path):
        return {"filename": filename, "total_pages": 1}
    count = get_pdf_page_count(file_path)
    return {"filename": filename, "total_pages": count or 1}

@app.get("/api/file-content")
def get_file_content(filename: str = Query(...)):
    uploads_dir = user_upload_dir()
    filename = safe_filename(filename)
    file_path = os.path.join(uploads_dir, filename)
    if not os.path.exists(file_path):
        get_file_bytes(get_current_user(), filename, local_path=file_path)
    if not os.path.exists(file_path):
        return {"filename": filename, "content": "File content unavailable."}
    
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        return {"filename": filename, "content": content}
    except Exception as e:
        return {"filename": filename, "content": f"Error reading file: {str(e)}"}

@app.get("/api/pdf-page-image")
def get_pdf_page_image(filename: str = Query(...), page: int = Query(1, ge=1)):
    uploads_dir = user_upload_dir()
    filename = safe_filename(filename)
    file_path = os.path.join(uploads_dir, filename)
    
    if not os.path.exists(file_path):
        get_file_bytes(get_current_user(), filename, local_path=file_path)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
        
    img_bytes = render_pdf_page_image(file_path, page_num=page, dpi=150)
    if not img_bytes:
        raise HTTPException(status_code=500, detail="Failed to render PDF page image")
        
    return Response(content=img_bytes, media_type="image/png")


@app.get("/api/sessions")
def get_sessions():
    sessions = get_all_sessions()
    if not sessions:
        create_session("New Chat")
        sessions = get_all_sessions()
    return {"sessions": sessions}

@app.post("/api/sessions")
def create_new_session(title: str = "New Chat"):
    session_id = create_session(title)
    return {"session_id": session_id, "title": title}

@app.get("/api/sessions/{session_id}/messages")
def get_messages(session_id: str):
    messages = get_session_messages(session_id)
    return {"messages": messages}

@app.delete("/api/sessions/{session_id}")
def delete_chat_session(session_id: str):
    delete_session(session_id)
    return {"success": True}

@app.post("/api/reset")
def reset_all():
    clear_collection()
    sessions = get_all_sessions()
    for s in sessions:
        delete_session(s["session_id"])
    new_id = create_session("New Chat")
    return {"success": True, "new_session_id": new_id}

@app.post("/api/cleanup-orphaned")
def cleanup_orphaned():
    # Render's local filesystem is ephemeral.  A missing local upload is not
    # an orphaned vector, so this endpoint must never purge the durable Qdrant
    # knowledge base based solely on disk state.
    return {
        "success": True,
        "cleaned": 0,
        "orphaned_files": [],
        "message": "Skipped: Qdrant documents are retained when local files are unavailable.",
    }

@app.post("/api/chat/stream")
def stream_chat(data: dict):
    session_id = data.get("session_id")
    prompt = data.get("prompt")
    
    if not session_id or not prompt:
        raise HTTPException(status_code=400, detail="Missing session_id or prompt")
        
    user_id = get_current_user()
    messages = get_session_messages(session_id)
    add_message(session_id, "user", prompt)
    
    def sse_event_generator():
        set_current_user(user_id)
        try:
            # Prepare context and prompt once, then reuse for both frontend and LLM
            prompt_str, retrieved_contexts = prepare_context_and_prompt(prompt, messages)
            
            yield f"data: {json.dumps({'type': 'contexts', 'contexts': retrieved_contexts})}\n\n"
            
            # If no contexts found, yield the error message and return early
            if not prompt_str:
                error_msg = "I couldn't find any relevant information in the database to answer that."
                yield f"data: {json.dumps({'type': 'token', 'token': error_msg})}\n\n"
                yield f"data: {json.dumps({'type': 'done', 'full_text': error_msg})}\n\n"
                return
            
            full_text = ""
            # Stream the LLM response using the already-prepared prompt
            stream_gen = answer_query_stream_with_prompt(prompt_str)
            for token in stream_gen:
                full_text += token
                yield f"data: {json.dumps({'type': 'token', 'token': token})}\n\n"
                
            add_message(session_id, "assistant", full_text, retrieved_contexts)
            yield f"data: {json.dumps({'type': 'done', 'full_text': full_text})}\n\n"
        except Exception as e:
            err_msg = f"\n\n⚠️ *Backend Stream Error: {str(e)}*"
            yield f"data: {json.dumps({'type': 'token', 'token': err_msg})}\n\n"
            yield f"data: {json.dumps({'type': 'done', 'full_text': err_msg})}\n\n"
            
    return StreamingResponse(sse_event_generator(), media_type="text/event-stream")
