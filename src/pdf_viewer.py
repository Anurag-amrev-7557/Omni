import pymupdf
import io

def render_pdf_page_image(pdf_path: str, page_num: int = 1, dpi: int = 150) -> bytes:
    """
    Renders a specific PDF page to a PNG image byte stream using PyMuPDF.
    page_num is 1-indexed.
    """
    try:
        doc = pymupdf.open(pdf_path)
        if page_num < 1 or page_num > len(doc):
            page_num = 1
        page = doc.load_page(page_num - 1)
        pix = page.get_pixmap(dpi=dpi)
        img_bytes = pix.tobytes("png")
        doc.close()
        return img_bytes
    except Exception as e:
        print(f"Error rendering PDF page image: {e}")
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
