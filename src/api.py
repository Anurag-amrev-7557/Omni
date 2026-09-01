import os
import sys
import json
import shutil
import tempfile
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
    from src.generate import answer_query_stream, prepare_context_and_prompt
    from src.chat_db import init_chat_db, create_session, get_all_sessions, add_message, get_session_messages, delete_session
    from src.pdf_viewer import render_pdf_page_image, get_pdf_page_count, extract_pdf_page_text
except ImportError:
    from db import init_db, clear_collection, get_collection_stats, delete_file_from_collection
    from ingest import ingest_file
    from generate import answer_query_stream, prepare_context_and_prompt
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
    return {
        "status": "Active",
        "total_chunks": stats["total_chunks"],
        "files_count": len(stats["files"]),
        "files": stats["files"],
        "sessions_count": len(sessions)
    }

@app.get("/api/documents")
def list_documents():
    stats = get_collection_stats()
    uploads_dir = os.path.join(ROOT_DIR, "data", "uploaded_docs")
    available_files = []
    
    if os.path.exists(uploads_dir):
        for fname in os.listdir(uploads_dir):
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

@app.post("/api/chat/stream")
def stream_chat(data: dict):
    session_id = data.get("session_id")
    prompt = data.get("prompt")
    
    if not session_id or not prompt:
        raise HTTPException(status_code=400, detail="Missing session_id or prompt")
        
    messages = get_session_messages(session_id)
    add_message(session_id, "user", prompt)
    
    prompt_str, retrieved_contexts = prepare_context_and_prompt(prompt, messages)
    
    def sse_event_generator():
        try:
            yield f"data: {json.dumps({'type': 'contexts', 'contexts': retrieved_contexts})}\n\n"
            
            full_text = ""
            stream_gen = answer_query_stream(prompt, messages)
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

