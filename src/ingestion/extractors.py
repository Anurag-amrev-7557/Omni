"""Document text extraction from PDF and source code/text files."""
import os
from typing import List
import pymupdf
from langchain_core.documents import Document

from src.config.settings import settings
from src.generation.llm import invoke_groq_with_fallback
from src.generation.prompts import DOCUMENT_SUMMARY_PROMPT

SUPPORTED_EXTENSIONS = {
    # Documents
    ".pdf", ".txt", ".md", ".markdown", ".rst",
    # Programming Languages & Code
    ".py", ".ts", ".tsx", ".js", ".jsx", ".json",
    ".yaml", ".yml", ".go", ".rs", ".java", ".cpp",
    ".c", ".h", ".hpp", ".sql", ".sh", ".bash",
    ".css", ".scss", ".html", ".xml", ".toml"
}


def load_pages_with_pymupdf(file_path: str) -> List[Document]:
    """Extracts pages from a PDF file using PyMuPDF."""
    doc = pymupdf.open(file_path)
    pages = []
    try:
        for page_num in range(len(doc)):
            page = doc.load_page(page_num)
            text = page.get_text("text")
            if text.strip():
                pages.append(Document(page_content=text, metadata={"page": page_num + 1}))
    finally:
        doc.close()
    return pages


def load_pages_from_bytes(file_bytes: bytes, ext: str) -> List[Document]:
    """Extracts document pages directly from memory bytes for instant in-memory ingestion."""
    if ext == ".pdf":
        doc = pymupdf.open(stream=file_bytes, filetype="pdf")
        pages = []
        try:
            for page_num in range(len(doc)):
                page = doc.load_page(page_num)
                text = page.get_text("text")
                if text.strip():
                    pages.append(Document(page_content=text, metadata={"page": page_num + 1}))
        finally:
            doc.close()
        return pages
    else:
        text = file_bytes.decode("utf-8", errors="replace")
        return [Document(page_content=text, metadata={"page": 1})] if text.strip() else []


def load_text_document(file_path: str) -> List[Document]:
    """Loads plain text, markdown, or source code file."""
    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
        text = f.read()
    return [Document(page_content=text, metadata={"page": 1})] if text.strip() else []


def load_document(file_path: str) -> List[Document]:
    """Loads document pages from file_path into Documents based on extension."""
    ext = os.path.splitext(file_path)[1].lower()
    if ext == ".pdf":
        return load_pages_with_pymupdf(file_path)
    elif ext in SUPPORTED_EXTENSIONS:
        return load_text_document(file_path)
    return []


def generate_summary(pages: List[Document]) -> str:
    """Generates an executive summary using Groq LLM failover."""
    preview = "\n\n".join([p.page_content for p in pages[:3]])
    prompt = DOCUMENT_SUMMARY_PROMPT.format(preview=preview)
    res = invoke_groq_with_fallback(prompt, max_tokens=120)
    return res if res else "Executive summary unavailable."


def render_pdf_page_image(pdf_path: str, page_num: int = 1, dpi: int = 150) -> bytes:
    """Renders a specific PDF page to a PNG image byte stream using PyMuPDF (1-indexed)."""
    import gc
    doc = None
    try:
        doc = pymupdf.open(pdf_path)
        if page_num < 1 or page_num > len(doc):
            page_num = 1
        page = doc.load_page(page_num - 1)
        pix = page.get_pixmap(dpi=dpi)
        img_bytes = pix.tobytes("png")
        del pix
        return img_bytes
    except Exception as e:
        return None
    finally:
        if doc:
            doc.close()
        gc.collect()


def get_pdf_page_count(pdf_path: str) -> int:
    """Returns total page count for a PDF file."""
    doc = None
    try:
        doc = pymupdf.open(pdf_path)
        return len(doc)
    except Exception:
        return 1
    finally:
        if doc:
            doc.close()


def extract_pdf_page_text(pdf_path: str, page_num: int = 1) -> str:
    """Extracts raw text from a specific page in a PDF file (1-indexed)."""
    doc = None
    try:
        doc = pymupdf.open(pdf_path)
        if page_num < 1 or page_num > len(doc):
            page_num = 1
        page = doc.load_page(page_num - 1)
        return page.get_text("text")
    except Exception as e:
        return f"Error extracting page text: {e}"
    finally:
        if doc:
            doc.close()


