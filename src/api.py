import os
import sys
import json
import shutil
import tempfile
import asyncio
from typing import Optional
from fastapi import FastAPI, File, UploadFile, Query, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response, JSONResponse, FileResponse

# --- PATH RESOLUTION ---
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

try:
    from src.db import init_db, clear_collection, get_collection_stats, delete_file_from_collection
    from src.ingest import ingest_file
    from src.generate import answer_query_stream, answer_query_stream_with_prompt, prepare_context_and_prompt
    from src.chat_db import init_chat_db, create_session, get_all_sessions, add_message, get_session_messages, delete_session
    from src.pdf_viewer import render_pdf_page_image, get_pdf_page_count, extract_pdf_page_text
except ImportError:
    from db import init_db, clear_collection, get_collection_stats, delete_file_from_collection
    from ingest import ingest_file
    from generate import answer_query_stream, answer_query_stream_with_prompt, prepare_context_and_prompt
    from chat_db import init_chat_db, create_session, get_all_sessions, add_message, get_session_messages, delete_session
    from pdf_viewer import render_pdf_page_image, get_pdf_page_count, extract_pdf_page_text

app = FastAPI(
    title="Enterprise Multi-Document RAG API",
    description="Commercial REST API for Agentic RAG with Groq LPUs, Cross-Encoder Reranking, and PyMuPDF.",
    version="2.0.0"
)

# CORS middleware for Web Frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_origin_regex=r".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup_event():
    init_db()
    init_chat_db()

@app.get("/api/health")
def health_check():
    return {"status": "online", "version": "2.0.0"}

@app.get("/api/stats")
def get_stats():
    stats = get_collection_stats()
    sessions = get_all_sessions()
    
    # Check filesystem vs Qdrant discrepancy
    uploads_dir = os.path.join(ROOT_DIR, "data", "uploaded_docs")
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
    stats = get_collection_stats()
    uploads_dir = os.path.join(ROOT_DIR, "data", "uploaded_docs")
    available_files = []
    
    print(f"[DEBUG] Uploads directory: {uploads_dir}")
    print(f"[DEBUG] Directory exists: {os.path.exists(uploads_dir)}")
    print(f"[DEBUG] Files in Qdrant: {stats['files']}")
    
    if os.path.exists(uploads_dir):
        files_on_disk = os.listdir(uploads_dir)
        print(f"[DEBUG] Files on disk: {files_on_disk}")
        
        for fname in files_on_disk:
            fpath = os.path.join(uploads_dir, fname)
            if os.path.isfile(fpath):
                size_mb = round(os.path.getsize(fpath) / (1024 * 1024), 2)
                page_count = get_pdf_page_count(fpath) if fname.lower().endswith(".pdf") else 1
                available_files.append({
                    "filename": fname,
                    "size_mb": size_mb,
                    "pages": page_count,
                    "indexed": fname in stats["files"]
                })
    else:
        print(f"[DEBUG] Uploads directory does not exist, creating it...")
        os.makedirs(uploads_dir, exist_ok=True)
    
    print(f"[DEBUG] Returning {len(available_files)} available files")
    return {"documents": available_files}

@app.post("/api/upload")
async def upload_documents(files: list[UploadFile] = File(...)):
    uploads_dir = os.path.join(ROOT_DIR, "data", "uploaded_docs")
    os.makedirs(uploads_dir, exist_ok=True)
    
    ingested_count = 0
    errors = []
    
    for file in files:
        filename = file.filename
        save_path = os.path.join(uploads_dir, filename)
        content = await file.read()
        with open(save_path, "wb") as f:
            f.write(content)
            
        try:
            # Run heavy vector ingestion in threadpool to prevent event-loop freezing
            await asyncio.to_thread(ingest_file, save_path)
            ingested_count += 1
        except Exception as e:
            errors.append(f"{filename}: {str(e)}")
            
    return {
        "success": True,
        "ingested_count": ingested_count,
        "errors": errors
    }

@app.delete("/api/documents/{filename}")
def delete_document(filename: str):
    uploads_dir = os.path.join(ROOT_DIR, "data", "uploaded_docs")
    file_path = os.path.join(uploads_dir, filename)
    
    # 1. Delete physical file if exists
    if os.path.exists(file_path):
        try:
            os.remove(file_path)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error deleting file: {e}")
            
    # 2. Delete vectors from Qdrant
    delete_file_from_collection(filename)
    return {"success": True, "filename": filename}

@app.get("/api/download/{filename}")
def download_document(filename: str):
    uploads_dir = os.path.join(ROOT_DIR, "data", "uploaded_docs")
    file_path = os.path.join(uploads_dir, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path, filename=filename)

@app.post("/api/documents/{filename}/reindex")
def reindex_document(filename: str):
    uploads_dir = os.path.join(ROOT_DIR, "data", "uploaded_docs")
    file_path = os.path.join(uploads_dir, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    try:
        delete_file_from_collection(filename)
        ingest_file(file_path)
        return {"success": True, "filename": filename}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error re-indexing {filename}: {e}")

@app.get("/api/pdf-info")
def get_pdf_info(filename: str = Query(...)):
    uploads_dir = os.path.join(ROOT_DIR, "data", "uploaded_docs")
    file_path = os.path.join(uploads_dir, filename)
    if not os.path.exists(file_path):
        return {"filename": filename, "total_pages": 1}
    count = get_pdf_page_count(file_path)
    return {"filename": filename, "total_pages": count or 1}

@app.get("/api/file-content")
def get_file_content(filename: str = Query(...)):
    uploads_dir = os.path.join(ROOT_DIR, "data", "uploaded_docs")
    file_path = os.path.join(uploads_dir, filename)
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
    uploads_dir = os.path.join(ROOT_DIR, "data", "uploaded_docs")
    file_path = os.path.join(uploads_dir, filename)
    
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
    """Remove Qdrant vectors for files that no longer exist on disk."""
    stats = get_collection_stats()
    uploads_dir = os.path.join(ROOT_DIR, "data", "uploaded_docs")
    
    if not os.path.exists(uploads_dir):
        return {"success": True, "cleaned": 0, "message": "Uploads directory does not exist"}
    
    files_on_disk = set(os.listdir(uploads_dir))
    orphaned_files = [f for f in stats["files"] if f not in files_on_disk]
    
    cleaned_count = 0
    for orphan in orphaned_files:
        try:
            delete_file_from_collection(orphan)
            cleaned_count += 1
            print(f"[DEBUG] Cleaned up orphaned file: {orphan}")
        except Exception as e:
            print(f"[DEBUG] Error cleaning up {orphan}: {e}")
    
    return {
        "success": True,
        "cleaned": cleaned_count,
        "orphaned_files": orphaned_files,
        "message": f"Cleaned up {cleaned_count} orphaned file(s)"
    }

@app.post("/api/chat/stream")
def stream_chat(data: dict):
    session_id = data.get("session_id")
    prompt = data.get("prompt")
    
    if not session_id or not prompt:
        raise HTTPException(status_code=400, detail="Missing session_id or prompt")
        
    messages = get_session_messages(session_id)
    add_message(session_id, "user", prompt)
    
    def sse_event_generator():
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

