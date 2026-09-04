import gc
import io
import os
import threading
from collections import OrderedDict
import pymupdf
try:
    from src.memory import reclaim_memory
except ImportError:
    from memory import reclaim_memory

# Limit concurrent PyMuPDF pixmap renderings to prevent memory spikes
_RENDER_SEMAPHORE = threading.Semaphore(2)

# Small LRU cache for rendered pages (max 16 pages) to avoid repeated PyMuPDF rendering
_PAGE_CACHE: OrderedDict[str, bytes] = OrderedDict()
_PAGE_CACHE_LOCK = threading.Lock()
_MAX_PAGE_CACHE = 16


def render_pdf_page_image(pdf_path: str, page_num: int = 1, dpi: int = 100) -> bytes:
    """
    Renders a specific PDF page to a PNG image byte stream using PyMuPDF.
    page_num is 1-indexed. Clamped to 100 DPI max and guarded by a semaphore
    to prevent memory limit exceeded on 512MB RAM cloud environments.
    """
    if not os.path.exists(pdf_path):
        return None

    # Clamp DPI to 100 to keep pixmap allocations under ~3.5MB per page
    safe_dpi = min(max(int(dpi), 72), 100)

    try:
        mtime = os.path.getmtime(pdf_path)
    except Exception:
        mtime = 0
    cache_key = f"{pdf_path}:{mtime}:{page_num}:{safe_dpi}"

    with _PAGE_CACHE_LOCK:
        if cache_key in _PAGE_CACHE:
            _PAGE_CACHE.move_to_end(cache_key)
            return _PAGE_CACHE[cache_key]

    with _RENDER_SEMAPHORE:
        try:
            doc = pymupdf.open(pdf_path)
            if page_num < 1 or page_num > len(doc):
                page_num = 1
            page = doc.load_page(page_num - 1)
            pix = page.get_pixmap(dpi=safe_dpi)
            img_bytes = pix.tobytes("png")
            del pix
            del page
            doc.close()
            del doc

            with _PAGE_CACHE_LOCK:
                if len(_PAGE_CACHE) >= _MAX_PAGE_CACHE:
                    _PAGE_CACHE.popitem(last=False)
                _PAGE_CACHE[cache_key] = img_bytes

            reclaim_memory()
            return img_bytes
        except Exception as e:
            print(f"Error rendering PDF page image: {e}")
            reclaim_memory()
            return None

def get_pdf_page_count(pdf_path: str) -> int:
    try:
        doc = pymupdf.open(pdf_path)
        count = len(doc)
        doc.close()
        return count
    except Exception:
        return 0

def extract_pdf_page_text(pdf_path: str, page_num: int = 1) -> str:
    try:
        doc = pymupdf.open(pdf_path)
        if page_num < 1 or page_num > len(doc):
            page_num = 1
        page = doc.load_page(page_num - 1)
        text = page.get_text("text")
        doc.close()
        return text
    except Exception as e:
        return f"Error extracting page text: {e}"
