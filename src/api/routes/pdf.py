"""PDF sidecar viewer and file content inspection HTTP endpoints."""
import os
from fastapi import APIRouter, Depends, Query, Response, HTTPException

from src.core.auth import require_user
from src.storage.file_storage import resolve_document_path
from src.ingestion import render_pdf_page_image, get_pdf_page_count, extract_pdf_page_text

router = APIRouter(tags=["PDF Sidecar & Content"])


@router.get("/api/pdf-info")
def get_pdf_info(filename: str = Query(...), user_id: str = Depends(require_user)):
    """Returns total page count for a vault document."""
    file_path = resolve_document_path(filename, user_id=user_id)
    if not file_path or not os.path.exists(file_path):
        return {"filename": filename, "total_pages": 1}
    count = get_pdf_page_count(file_path)
    return {"filename": filename, "total_pages": count or 1}


@router.get("/api/file-content")
def get_file_content(filename: str = Query(...), user_id: str = Depends(require_user)):
    """Extracts raw text content for a document in the Knowledge Vault."""
    file_path = resolve_document_path(filename, user_id=user_id)
    if not file_path or not os.path.exists(file_path):
        return {"filename": filename, "content": "File content unavailable."}

    if filename.lower().endswith(".pdf"):
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

    return Response(content=img_bytes, media_type="image/png")
