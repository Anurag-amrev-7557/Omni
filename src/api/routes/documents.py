"""Document management, upload streaming, and ingestion HTTP endpoints."""
import asyncio
import json
import os
import time
from typing import Any, List, Optional
from pydantic import BaseModel
from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

from src.config.settings import settings
from src.core.auth import require_user, set_current_user
from src.core.logging import logger
from src.core.security import is_default_or_local_user, sanitize_filename, sanitize_user_id_for_path
from src.graph import delete_document_graph
from src.ingestion import extract_pdf_page_text, get_pdf_page_count, render_pdf_page_image
from src.ingestion.extractors import SUPPORTED_EXTENSIONS, load_pages_from_bytes
from src.ingestion.service import extract_graph_for_file, ingest_file
from src.storage.docs_db import (
    delete_document_record,
    delete_document_records,
    get_user_documents,
    update_document_status,
    upsert_document_record,
)
from src.storage.file_storage import (
    delete_file,
    delete_physical_document,
    get_user_uploads_dir,
    resolve_document_path,
    upload_bytes,
)
from src.storage.vector_store import (
    delete_file_from_collection,
    delete_files_from_collection,
    get_collection_stats,
)

router = APIRouter(tags=["Documents"])


class BatchDeleteRequest(BaseModel):
    filenames: List[str]


def _write_bytes_to_file(path: str, data: bytes) -> str:
    """Safely writes bytes to disk, guaranteeing parent directory creation and fallback to /tmp."""
    parent = os.path.dirname(path)
    try:
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
        return path
    except Exception as e:
        logger.warning(f"Failed to write to {path} ({e}). Falling back to /tmp...")
        filename = os.path.basename(path)
        safe_dir = os.path.join("/tmp", "rag_uploads", "fallback")
        os.makedirs(safe_dir, exist_ok=True)
        fallback_path = os.path.join(safe_dir, filename)
        with open(fallback_path, "wb") as f:
            f.write(data)
        return fallback_path


@router.get("/api/documents")
def get_documents(response: Response = None, user_id: str = Depends(require_user)):
    """Lists all documents belonging strictly to the authenticated user."""
    if response:
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    set_current_user(user_id)

    stats = get_collection_stats(user_id=user_id)
    available_files = []
    seen = set()

    for doc in get_user_documents(user_id=user_id):
        fname = doc["filename"]
        if fname not in seen and not fname.startswith("."):
            seen.add(fname)
            available_files.append({
                "filename": fname,
                "size_mb": doc.get("size_mb", 0.0),
                "pages": doc.get("pages", 1),
                "indexed": fname in stats.get("files", []) or doc.get("indexed", True),
                "status": doc.get("status", "ready"),
                "summary": doc.get("summary", ""),
            })

    if not available_files:
        safe_uid = sanitize_user_id_for_path(user_id)
        candidate_dirs = [
            get_user_uploads_dir(user_id),
            os.path.join("/tmp", "rag_uploads", safe_uid),
            os.path.join(settings.UPLOADS_DIR, safe_uid),
        ]
        if is_default_or_local_user(user_id):
            candidate_dirs.extend([
                os.path.join(settings.UPLOADS_DIR, "default"),
                os.path.join("/tmp", "rag_uploads", "default"),
            ])

        for udir in candidate_dirs:
            if os.path.exists(udir):
                for fname in sorted(os.listdir(udir)):
                    if fname not in seen and not fname.startswith("."):
                        fpath = os.path.join(udir, fname)
                        if os.path.isfile(fpath):
                            seen.add(fname)
                            available_files.append({
                                "filename": fname,
                                "size_mb": round(os.path.getsize(fpath) / (1024 * 1024), 2),
                                "pages": get_pdf_page_count(fpath) if fname.lower().endswith(".pdf") else 1,
                                "indexed": fname in stats.get("files", []),
                                "status": "ready",
                                "summary": "",
                            })

    for fname in stats.get("files", []):
        if fname not in seen and not fname.startswith("."):
            seen.add(fname)
            available_files.append({
                "filename": fname,
                "size_mb": 0.0,
                "pages": 1,
                "indexed": True,
                "status": "ready",
                "summary": "",
            })

    return {"documents": available_files}


async def _save_and_ingest_single_document(
    filename: str,
    content: bytes,
    user_id: str,
    on_progress: Optional[Any] = None,
) -> dict:
    """Unified storage, single-pass extraction, vector indexing, and background graph extraction."""
    ext = os.path.splitext(filename)[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported file format '{ext}'")

    async def _bg_cloud_backup():
        try:
            await asyncio.to_thread(upload_bytes, content, f"users/{user_id}/{filename}")
        except Exception as se:
            logger.debug(f"Storage upload notice for {filename}: {se}")
    asyncio.create_task(_bg_cloud_backup())

    user_dir = get_user_uploads_dir(user_id)
    save_path = await asyncio.to_thread(_write_bytes_to_file, os.path.join(user_dir, filename), content)

    pages = await asyncio.to_thread(load_pages_from_bytes, content, ext)
    if not pages:
        raise ValueError(f"No text content could be extracted from {filename}.")

    await asyncio.to_thread(
        upsert_document_record,
        filename,
        user_id=user_id,
        size_bytes=len(content),
        page_count=len(pages),
        status="indexing",
    )

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
        preloaded_pages=pages,
    )

    await asyncio.to_thread(
        update_document_status,
        filename,
        user_id=user_id,
        status="ready",
        chunk_count=ingest_res.get("chunk_count", 0),
        summary=ingest_res.get("summary", ""),
    )

    parent_chunks = ingest_res.get("parent_chunks")
    async def _bg_graph(sp=save_path, fn=filename, uid=user_id, pc=parent_chunks):
        try:
            await asyncio.to_thread(extract_graph_for_file, sp, fn, uid, pc)
        except Exception as ge:
            logger.debug(f"Background graph extraction error for {fn}: {ge}")
    asyncio.create_task(_bg_graph())

    return ingest_res


@router.post("/api/upload")
async def upload_documents(files: List[UploadFile] = File(...), user_id: str = Depends(require_user)):
    """Uploads and indexes multiple documents with bounded concurrency and size validation."""
    set_current_user(user_id)
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024

    ingested_count = 0
    errors: List[str] = []
    sem = asyncio.Semaphore(3)

    async def _process_single(file: UploadFile):
        nonlocal ingested_count
        try:
            filename = sanitize_filename(file.filename or "unknown")
        except ValueError as e:
            errors.append(f"Invalid filename: {e}")
            return

        if file.size and file.size > max_bytes:
            errors.append(f"{filename}: File too large (max {settings.MAX_UPLOAD_SIZE_MB}MB)")
            return

        async with sem:
            try:
                content = await file.read()
                if len(content) > max_bytes:
                    errors.append(f"{filename}: File too large (max {settings.MAX_UPLOAD_SIZE_MB}MB)")
                    return
                if len(content) == 0:
                    errors.append(f"{filename}: File is empty")
                    return

                await _save_and_ingest_single_document(filename, content, user_id)
                ingested_count += 1
            except Exception as e:
                logger.error(f"Error ingesting {filename}: {e}", exc_info=True)
                errors.append(f"{filename}: {e}")

    await asyncio.gather(*[_process_single(f) for f in files])

    docs_res = await asyncio.to_thread(get_documents, user_id=user_id)
    return {
        "success": ingested_count > 0 and len(errors) == 0,
        "ingested_count": ingested_count,
        "total_files": len(files),
        "errors": errors,
        "documents": docs_res.get("documents", []),
    }


@router.post("/api/upload-stream")
async def upload_document_stream(file: UploadFile = File(...), user_id: str = Depends(require_user)):
    """Stream-based file upload with real-time SSE progress events and single-pass memory extraction."""
    set_current_user(user_id)
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024

    try:
        filename = sanitize_filename(file.filename or "unknown")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid filename: {e}")

    if file.size and file.size > max_bytes:
        raise HTTPException(status_code=413, detail=f"File too large (max {settings.MAX_UPLOAD_SIZE_MB}MB)")

    try:
        content = await file.read()
        if len(content) > max_bytes:
            raise HTTPException(status_code=413, detail=f"File too large (max {settings.MAX_UPLOAD_SIZE_MB}MB)")
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="File is empty")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error reading file: {e}")

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

        await q.put({"type": "progress", "stage": "reading", "progress": 15, "message": "Extracting text content...", "filename": filename})

        async def _run_ingest():
            try:
                await _save_and_ingest_single_document(
                    filename=filename,
                    content=content,
                    user_id=user_id,
                    on_progress=_progress_cb,
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
                    break
            except asyncio.TimeoutError:
                yield json.dumps({"type": "error", "error": "Upload timeout", "filename": filename}) + "\n"
                break

        await ingest_task

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")


def _perform_document_deletion(filenames: List[str], user_id: str) -> None:
    """Unified document deletion across storage, vector database, graph database, and relational records."""
    for fn in filenames:
        delete_physical_document(fn, user_id=user_id)
        delete_file(f"users/{user_id}/{fn}")
        delete_document_graph(fn, user_id=user_id)

    delete_files_from_collection(filenames, user_id=user_id)
    delete_document_records(filenames, user_id=user_id)


@router.delete("/api/documents/{filename}")
def delete_document(filename: str, user_id: str = Depends(require_user)):
    """Deletes a document from vector store, database, and filesystem scoped strictly to user."""
    set_current_user(user_id)
    _perform_document_deletion([filename], user_id=user_id)
    return {"success": True, "filename": filename}


@router.post("/api/documents/batch-delete")
def batch_delete_documents(req: BatchDeleteRequest, user_id: str = Depends(require_user)):
    """Batch deletes multiple documents with tenant scoping."""
    set_current_user(user_id)
    filenames = req.filenames
    if filenames:
        _perform_document_deletion(filenames, user_id=user_id)
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
    return {
        "success": True,
        "filename": filename,
        "processing_time": round(time.time() - start_time, 2),
        "features_enabled": {
            "knowledge_graph": extract_graph,
            "ai_summary": generate_summary,
        },
    }


@router.post("/api/documents/batch-enhance")
async def batch_enhance_documents(
    filenames: List[str],
    user_id: str = Depends(require_user),
    extract_graph: bool = Query(default=True),
    generate_summary: bool = Query(default=True),
):
    """Enhances multiple documents in batch with bounded concurrency."""
    set_current_user(user_id)
    if not filenames:
        return {
            "success": True,
            "total_files": 0,
            "successful": 0,
            "failed": 0,
            "total_time": 0.0,
            "results": [],
        }

    total_start = time.time()
    sem = asyncio.Semaphore(2)

    async def _enhance_single(filename: str) -> dict:
        file_path = resolve_document_path(filename, user_id=user_id)
        if not file_path or not os.path.exists(file_path):
            return {"filename": filename, "success": False, "error": "File not found"}
        try:
            file_start = time.time()
            async with sem:
                await asyncio.to_thread(
                    ingest_file,
                    file_path,
                    user_id,
                    extract_graph=extract_graph,
                    generate_ai_summary=generate_summary,
                )
            return {
                "filename": filename,
                "success": True,
                "processing_time": round(time.time() - file_start, 2),
            }
        except Exception as e:
            return {"filename": filename, "success": False, "error": str(e)}

    results = await asyncio.gather(*[_enhance_single(fn) for fn in filenames])
    total_elapsed = time.time() - total_start
    success_count = sum(1 for r in results if r["success"])
    return {
        "success": success_count > 0,
        "total_files": len(filenames),
        "successful": success_count,
        "failed": len(filenames) - success_count,
        "total_time": round(total_elapsed, 2),
        "results": list(results),
    }


@router.get("/api/pdf-info")
def get_pdf_info(filename: str = Query(...), user_id: str = Depends(require_user)):
    """Returns total page count for a vault document, checking DB cache before parsing disk."""
    for doc in get_user_documents(user_id=user_id):
        if doc.get("filename") == filename and doc.get("pages"):
            return {"filename": filename, "total_pages": doc["pages"]}

    file_path = resolve_document_path(filename, user_id=user_id)
    count = get_pdf_page_count(file_path) if file_path and os.path.exists(file_path) else 1
    return {"filename": filename, "total_pages": count or 1}


@router.get("/api/file-content")
def get_file_content(
    filename: str = Query(...),
    max_pages: int = Query(default=5, ge=1, le=50),
    user_id: str = Depends(require_user),
):
    """Extracts raw text content for a document in the Knowledge Vault."""
    file_path = resolve_document_path(filename, user_id=user_id)
    if not file_path or not os.path.exists(file_path):
        return {"filename": filename, "content": "File content unavailable."}

    if filename.lower().endswith(".pdf"):
        try:
            pages = [t.strip() for p in range(1, max_pages + 1) if (t := extract_pdf_page_text(file_path, p)) and not t.startswith("Error")]
            return {"filename": filename, "content": "\n\n---\n\n".join(pages) if pages else "No text extracted from PDF."}
        except Exception as pe:
            return {"filename": filename, "content": f"PDF extraction note: {pe}"}

    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            chunk = f.read(500_000)
            if f.read(1):
                chunk += "\n\n[... Content truncated for preview ...]"
            return {"filename": filename, "content": chunk}
    except Exception as e:
        return {"filename": filename, "content": f"Error reading file: {e}"}


@router.get("/api/pdf-page-image")
def get_pdf_page_image(
    filename: str = Query(...),
    page: int = Query(1, ge=1),
    user_id: str = Depends(require_user),
):
    """Renders a single PDF page to a PNG image byte stream for sidecar verification."""
    file_path = resolve_document_path(filename, user_id=user_id)
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    img_bytes = render_pdf_page_image(file_path, page_num=page, dpi=150)
    if not img_bytes:
        raise HTTPException(status_code=500, detail="Failed to render PDF page image")

    return Response(
        content=img_bytes,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400, immutable"},
    )

