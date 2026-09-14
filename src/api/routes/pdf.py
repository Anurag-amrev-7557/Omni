"""PDF sidecar viewer and file content inspection HTTP endpoints."""
import os
from fastapi import APIRouter, Depends, HTTPException, Query, Response

from src.core.auth import require_user
from src.ingestion import extract_pdf_page_text, get_pdf_page_count, render_pdf_page_image
from src.storage.file_storage import resolve_document_path

router = APIRouter(tags=["PDF Sidecar & Content"])


@router.get("/api/pdf-info")
def get_pdf_info(filename: str = Query(...), user_id: str = Depends(require_user)):
    """Returns total page count for a vault document."""
    file_path = resolve_document_path(filename, user_id=user_id)
    count = get_pdf_page_count(file_path) if file_path and os.path.exists(file_path) else 1
    return {"filename": filename, "total_pages": count or 1}


@router.get("/api/file-content")
def get_file_content(filename: str = Query(...), user_id: str = Depends(require_user)):
    """Extracts raw text content for a document in the Knowledge Vault."""
    file_path = resolve_document_path(filename, user_id=user_id)
    if not file_path or not os.path.exists(file_path):
        return {"filename": filename, "content": "File content unavailable."}

    if filename.lower().endswith(".pdf"):
        try:
            pages = [t.strip() for p in range(1, 4) if (t := extract_pdf_page_text(file_path, p)) and not t.startswith("Error")]
            return {"filename": filename, "content": "\n\n---\n\n".join(pages) if pages else "No text extracted from PDF."}
        except Exception as pe:
            return {"filename": filename, "content": f"PDF extraction note: {pe}"}

    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            return {"filename": filename, "content": f.read()}
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
