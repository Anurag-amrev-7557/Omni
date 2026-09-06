"""Document management, upload streaming, and ingestion HTTP endpoints."""
import os
import time
import json
import asyncio
from typing import Optional, List, Any, Dict
from pydantic import BaseModel
from fastapi import APIRouter, UploadFile, File, Query, Depends, HTTPException, Response
from fastapi.responses import StreamingResponse, FileResponse

from src.config.settings import settings
from src.core.logging import logger
from src.core.auth import require_user, set_current_user
from src.core.security import sanitize_filename
from src.storage.vector_store import (
    get_collection_stats,
    delete_file_from_collection,
    delete_files_from_collection,
)
from src.storage.docs_db import (
    get_user_documents,
    upsert_document_record,
    update_document_status,
    delete_document_records,
    delete_document_record,
)
from src.storage.file_storage import (
    get_user_uploads_dir,
    resolve_document_path,
    upload_bytes,
    delete_file,
    delete_physical_document,
    get_user_files,
)
from src.ingestion import get_pdf_page_count
from src.ingestion.service import ingest_file, extract_graph_for_file
from src.graph import delete_document_graph

router = APIRouter(tags=["Documents"])


class BatchDeleteRequest(BaseModel):
    filenames: List[str]


@router.get("/api/documents")
def get_documents(response: Response = None, user_id: str = Depends(require_user)):
    """Lists all documents belonging strictly to the authenticated user."""
    if response:
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    set_current_user(user_id)

    stats = get_collection_stats(user_id=user_id)
    db_docs = get_user_documents(user_id=user_id)

    available_files = []
    seen = set()

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

    # Also check local user directory
    user_uploads_dir = get_user_uploads_dir(user_id)
    if os.path.exists(user_uploads_dir):
        for fname in sorted(os.listdir(user_uploads_dir)):
            if fname not in seen and not fname.startswith("."):
                fpath = os.path.join(user_uploads_dir, fname)
                if os.path.isfile(fpath):
                    seen.add(fname)
                    size_mb = round(os.path.getsize(fpath) / (1024 * 1024), 2)
                    pages = get_pdf_page_count(fpath) if fname.lower().endswith(".pdf") else 1
                    available_files.append({
                        "filename": fname,
                        "size_mb": size_mb,
                        "pages": pages,
                        "indexed": fname in stats["files"],
                        "status": "ready",
                        "summary": "",
                    })

    return {"documents": available_files}


def _write_bytes_to_file(path: str, data: bytes):
    with open(path, "wb") as f:
        f.write(data)


async def _save_and_ingest_single_document(
    filename: str,
    content: bytes,
    user_id: str,
    on_progress: Optional[Any] = None,
) -> dict:
    """Unified storage, database registration, vector indexing, and background graph extraction."""
    # 1. Supabase storage upload if configured
    try:
        await asyncio.to_thread(upload_bytes, content, f"users/{user_id}/{filename}")
    except Exception as se:
        logger.debug(f"Storage upload notice for {filename}: {se}")

    # 2. Local file persistence
    user_dir = get_user_uploads_dir(user_id)
    save_path = os.path.join(user_dir, filename)
    await asyncio.to_thread(_write_bytes_to_file, save_path, content)

    # 3. Document metadata registration
    page_count = await asyncio.to_thread(get_pdf_page_count, save_path) if filename.lower().endswith(".pdf") else 1
    await asyncio.to_thread(
        upsert_document_record,
        filename,
        user_id=user_id,
        size_bytes=len(content),
        page_count=page_count,
        status="ready",
    )

    # 4. Ingest vectors
    await asyncio.to_thread(delete_file_from_collection, filename, user_id=user_id)
    ingest_res = await asyncio.to_thread(
        ingest_file,
        save_path,
        user_id=user_id,
        file_bytes=content,
        filename=filename,
        extract_graph=False,
        generate_ai_summary=False,
        on_progress=on_progress,
    )

    # 5. Update ready status & chunk counts
    await asyncio.to_thread(
        update_document_status,
        filename,
        user_id=user_id,
        status="ready",
        chunk_count=ingest_res.get("chunk_count", 0),
        summary=ingest_res.get("summary", ""),
    )

    # 6. Fire-and-forget background graph extraction
    _sp, _fn, _uid = save_path, filename, user_id
    async def _bg_graph(sp=_sp, fn=_fn, uid=_uid):
        try:
            await asyncio.to_thread(extract_graph_for_file, sp, fn, uid)
        except Exception as ge:
            logger.debug(f"Background graph extraction error for {fn}: {ge}")
    asyncio.create_task(_bg_graph())

    return ingest_res


@router.post("/api/upload")
async def upload_documents(files: List[UploadFile] = File(...), user_id: str = Depends(require_user)):
    """Uploads and indexes multiple documents into user vault with size validation."""
    set_current_user(user_id)
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024

    ingested_count = 0
    errors = []
    processing_times = []

    for file in files:
        try:
            filename = sanitize_filename(file.filename or "unknown")
        except ValueError as e:
            errors.append(f"Invalid filename: {str(e)}")
            continue

        try:
            content = await file.read()
            if len(content) > max_bytes:
                errors.append(f"{filename}: File too large (max {settings.MAX_UPLOAD_SIZE_MB}MB)")
                continue
            if len(content) == 0:
                errors.append(f"{filename}: File is empty")
                continue

            file_start = time.time()
            await _save_and_ingest_single_document(filename, content, user_id)
            ingested_count += 1
            processing_times.append(time.time() - file_start)
        except Exception as e:
            logger.error(f"Error ingesting {file.filename}: {e}", exc_info=True)
            errors.append(f"{file.filename}: {str(e)}")

    docs_res = await asyncio.to_thread(get_documents, user_id=user_id)
    updated_docs = docs_res.get("documents", [])
    return {
        "success": ingested_count > 0 and len(errors) == 0,
        "ingested_count": ingested_count,
        "total_files": len(files),
        "errors": errors,
        "documents": updated_docs,
    }


@router.post("/api/upload-stream")
async def upload_document_stream(file: UploadFile = File(...), user_id: str = Depends(require_user)):
    """Stream-based file upload with real-time SSE progress events."""
    set_current_user(user_id)
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024

    try:
        filename = sanitize_filename(file.filename or "unknown")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid filename: {str(e)}")

    try:
        content = await file.read()
        if len(content) > max_bytes:
            raise HTTPException(status_code=413, detail=f"File too large (max {settings.MAX_UPLOAD_SIZE_MB}MB)")
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="File is empty")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error reading file: {str(e)}")

    async def event_generator():
        q = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def _progress_cb(stage: str, progress: int, message: str):
            try:
                loop.call_soon_threadsafe(
                    q.put_nowait,
                    {"type": "progress", "stage": stage, "progress": progress, "message": message, "filename": filename}
                )
            except Exception as e:
                logger.debug(f"Queue error: {e}")

        # Upload to Supabase Storage
        try:
            await asyncio.to_thread(upload_bytes, content, f"users/{user_id}/{filename}")
            await q.put({"type": "progress", "stage": "storage", "progress": 3, "message": "Stored in Supabase", "filename": filename})
        except Exception as e:
            await q.put({"type": "error", "error": f"Failed to store file: {str(e)}", "filename": filename})
            yield json.dumps({"type": "error", "error": f"Failed to store file: {str(e)}", "filename": filename}) + "\n"
            return

        user_dir = get_user_uploads_dir(user_id)
        save_path = os.path.join(user_dir, filename)
        try:
            await asyncio.to_thread(_write_bytes_to_file, save_path, content)
        except Exception as e:
            await q.put({"type": "error", "error": f"Failed to save file: {str(e)}", "filename": filename})
            yield json.dumps({"type": "error", "error": f"Failed to save file: {str(e)}", "filename": filename}) + "\n"
            return

        page_count = await asyncio.to_thread(get_pdf_page_count, save_path) if filename.lower().endswith(".pdf") else 1
        await asyncio.to_thread(
            upsert_document_record,
            filename,
            user_id=user_id,
            size_bytes=len(content),
            page_count=page_count,
            status="ready",
        )
        await asyncio.to_thread(delete_file_from_collection, filename, user_id=user_id)

        await q.put({"type": "progress", "stage": "reading", "progress": 15, "message": "Extracting text content...", "filename": filename})

        async def _run_ingest():
            try:
                ingest_res = await asyncio.to_thread(
                    ingest_file,
                    save_path,
                    user_id=user_id,
                    file_bytes=content,
                    filename=filename,
                    extract_graph=False,
                    generate_ai_summary=False,
                    on_progress=_progress_cb,
                )
                await asyncio.to_thread(
                    update_document_status,
                    filename,
                    user_id=user_id,
                    status="ready",
                    chunk_count=ingest_res.get("chunk_count", 0),
                    summary=ingest_res.get("summary", ""),
                )
                await q.put({"type": "done", "success": True, "filename": filename})
            except Exception as e:
                logger.error(f"Ingestion error for {filename}: {e}", exc_info=True)
                await q.put({"type": "error", "error": str(e), "filename": filename})

        ingest_task = asyncio.create_task(_run_ingest())

        while True:
            try:
                item = await asyncio.wait_for(q.get(), timeout=300)
                yield json.dumps(item) + "\n"
                if item.get("type") in ("done", "error"):
                    if item.get("type") == "done":
                        async def _bg_graph():
                            try:
                                await asyncio.to_thread(extract_graph_for_file, save_path, filename, user_id)
                            except Exception as ge:
                                logger.debug(f"Background graph extraction error: {ge}")
                        asyncio.create_task(_bg_graph())
                    break
            except asyncio.TimeoutError:
                await q.put({"type": "error", "error": "Upload timeout", "filename": filename})
                yield json.dumps({"type": "error", "error": "Upload timeout", "filename": filename}) + "\n"
                break

        await ingest_task

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")


@router.delete("/api/documents/{filename}")
def delete_document(filename: str, user_id: str = Depends(require_user)):
    """Deletes a document from vector store, database, and filesystem scoped strictly to user."""
    set_current_user(user_id)
    delete_physical_document(filename, user_id=user_id)
    delete_file_from_collection(filename, user_id=user_id)
    delete_file(f"users/{user_id}/{filename}")
    delete_document_record(filename, user_id=user_id)
    delete_document_graph(filename, user_id=user_id)
    return {"success": True, "filename": filename}


@router.post("/api/documents/batch-delete")
def batch_delete_documents(req: BatchDeleteRequest, user_id: str = Depends(require_user)):
    """Batch deletes multiple documents with tenant scoping."""
    set_current_user(user_id)
    filenames = req.filenames
    if not filenames:
        return {"success": True, "deleted": []}

    for fn in filenames:
        delete_physical_document(fn, user_id=user_id)
        delete_file(f"users/{user_id}/{fn}")
        delete_document_graph(fn, user_id=user_id)

    delete_files_from_collection(filenames, user_id=user_id)
    delete_document_records(filenames, user_id=user_id)
    return {"success": True, "deleted": filenames}


@router.get("/api/download/{filename}")
def download_document(filename: str, user_id: str = Depends(require_user)):
    """Downloads the original document file."""
    file_path = resolve_document_path(filename, user_id=user_id)
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path, filename=os.path.basename(file_path))


@router.post("/api/documents/{filename}/reindex")
def reindex_document(filename: str, user_id: str = Depends(require_user)):
    """Re-indexes an existing document."""
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


@router.post("/api/documents/{filename}/enhance")
async def enhance_document(
    filename: str,
    user_id: str = Depends(require_user),
    extract_graph: bool = Query(default=True),
    generate_summary: bool = Query(default=True),
):
    """Enhances an indexed document with knowledge graph extraction and AI summary."""
    set_current_user(user_id)
    file_path = resolve_document_path(filename, user_id=user_id)
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    start_time = time.time()
    await asyncio.to_thread(
        ingest_file,
        file_path,
        user_id,
        extract_graph=extract_graph,
        generate_ai_summary=generate_summary,
    )
    elapsed = time.time() - start_time
    return {
        "success": True,
        "filename": filename,
        "processing_time": round(elapsed, 2),
        "features_enabled": {
            "knowledge_graph": extract_graph,
            "ai_summary": generate_summary,
        }
    }


@router.post("/api/documents/batch-enhance")
async def batch_enhance_documents(
    filenames: List[str],
    user_id: str = Depends(require_user),
    extract_graph: bool = Query(default=True),
    generate_summary: bool = Query(default=True),
):
    """Enhances multiple documents in batch."""
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
                generate_ai_summary=generate_summary,
            )
            elapsed = time.time() - file_start
            results.append({"filename": filename, "success": True, "processing_time": round(elapsed, 2)})
        except Exception as e:
            results.append({"filename": filename, "success": False, "error": str(e)})

    total_elapsed = time.time() - total_start
    success_count = sum(1 for r in results if r["success"])
    return {
        "success": success_count > 0,
        "total_files": len(filenames),
        "successful": success_count,
        "failed": len(filenames) - success_count,
        "total_time": round(total_elapsed, 2),
        "results": results,
    }
