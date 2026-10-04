"""Document Ingestion Service: parsing, hierarchical chunking, and vector indexing."""
import gc
import os
import time
from typing import Any, Callable, Dict, List, Optional
from langchain_core.documents import Document
from langchain_qdrant import QdrantVectorStore

from src.config.settings import settings
from src.core.auth import get_current_user
from src.core.logging import logger
from src.core.security import normalize_user_id
from src.graph import extract_and_cluster
from src.ingestion.chunking import get_parent_splitter, split_hierarchical_chunks
from src.ingestion.extractors import (
    SUPPORTED_EXTENSIONS,
    generate_summary,
    load_document,
    load_pages_from_bytes,
)
from src.retrieval.embeddings import get_embeddings
from src.storage.vector_store import get_qdrant_client, init_db, invalidate_stats_cache


def _sample_chunks(chunks: List[Document], max_count: int = 6) -> List[Document]:
    """Uniformly samples up to max_count chunks across the document sequence."""
    n = len(chunks)
    if n <= max_count:
        return chunks
    return [chunks[int(i * (n - 1) / (max_count - 1))] for i in range(max_count)]


def _run_knowledge_graph_pipeline(chunks: List[Document], filename: str, user_id: str):
    """Encapsulates the knowledge graph entity/relation extraction and clustering pipeline."""
    try:
        extract_and_cluster(chunks, filename, user_id)
    except Exception as e:
        logger.warning(f"Graph extraction notice for {filename}: {e}")


def ingest_file(
    file_path: Optional[str] = None,
    user_id: Optional[str] = None,
    extract_graph: bool = False,
    generate_ai_summary: bool = False,
    on_progress: Optional[Callable[[str, int, str], None]] = None,
    file_bytes: Optional[bytes] = None,
    filename: Optional[str] = None,
    preloaded_pages: Optional[List[Document]] = None,
) -> Dict[str, Any]:
    """Ingests a file with PyMuPDF extraction, hierarchical parent-child chunking, and dense vector storage."""
    start_time = time.time()
    init_db()

    if on_progress:
        on_progress("reading", 10, "Extracting text content...")

    effective_uid = user_id or get_current_user()
    norm_uid = normalize_user_id(effective_uid)
    filename = filename or (os.path.basename(file_path) if file_path else "document.pdf")

    ext = os.path.splitext(filename)[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported file format '{ext}'. Supported: PDF, Markdown, Text, and Source Code files.")

    if preloaded_pages is not None:
        pages = preloaded_pages
    elif file_bytes is not None:
        pages = load_pages_from_bytes(file_bytes, ext)
    else:
        pages = load_document(file_path)

    if not pages:
        raise ValueError(f"No text content could be extracted from {filename}.")

    if generate_ai_summary and ext in {".pdf", ".md", ".txt"}:
        summary = generate_summary(pages)
    else:
        total_words = sum(len(p.page_content.split()) for p in pages)
        page_word = "page" if len(pages) == 1 else "pages"
        summary = f"{filename} ({len(pages)} {page_word}, ~{total_words:,} words)"

    if on_progress:
        on_progress("chunking", 30, f"Splitting {len(pages)} pages into semantic chunks...")

    parent_docs, child_documents = split_hierarchical_chunks(
        pages=pages,
        summary=summary,
        filename=filename,
        user_id=norm_uid,
    )

    if on_progress:
        on_progress("embedding", 60, f"Generating dense embeddings for {len(child_documents)} chunks...")

    vector_store = QdrantVectorStore(
        client=get_qdrant_client(),
        collection_name=settings.COLLECTION_NAME,
        embedding=get_embeddings(),
    )

    batch_size = 64
    total_child = len(child_documents)
    logger.info(f"Indexing {total_child} child vectors for {filename} (user: {norm_uid})...")

    if total_child <= batch_size:
        if on_progress:
            on_progress("indexing", 75, f"Storing {total_child} vectors in Qdrant collection...")
        vector_store.add_documents(child_documents, batch_size=batch_size)
    else:
        for offset in range(0, total_child, batch_size):
            batch = child_documents[offset : offset + batch_size]
            current_count = min(offset + batch_size, total_child)
            progress_pct = 50 + int((current_count / total_child) * 45)
            if on_progress:
                on_progress("indexing", progress_pct, f"Indexing vectors ({current_count}/{total_child})...")
            vector_store.add_documents(batch, batch_size=batch_size)

    invalidate_stats_cache(user_id=norm_uid)

    elapsed_time = time.time() - start_time
    total_page_count = len(pages)
    total_chunk_count = len(child_documents)
    chunks_to_process = _sample_chunks(parent_docs)

    del child_documents, pages
    gc.collect()

    if on_progress:
        on_progress("completed", 100, f"Indexed successfully ({elapsed_time:.1f}s)")

    if extract_graph and chunks_to_process:
        _run_knowledge_graph_pipeline(chunks_to_process, filename, norm_uid)

    return {
        "success": True,
        "filename": filename,
        "page_count": total_page_count,
        "chunk_count": total_chunk_count,
        "summary": summary,
        "elapsed_seconds": round(elapsed_time, 2),
        "parent_chunks": chunks_to_process,
    }


def extract_graph_for_file(
    file_path: Optional[str] = None,
    filename: Optional[str] = None,
    user_id: Optional[str] = None,
    precomputed_chunks: Optional[List[Document]] = None,
):
    """Standalone background graph extraction reusing in-memory chunks without disk re-reading."""
    clean_fn = filename or (os.path.basename(file_path) if file_path else "document")
    norm_uid = normalize_user_id(user_id)

    if precomputed_chunks:
        _run_knowledge_graph_pipeline(_sample_chunks(precomputed_chunks), clean_fn, norm_uid)
        return

    if not file_path or not os.path.exists(file_path):
        logger.debug(f"Skipping graph extraction for missing file path '{clean_fn}'")
        return

    pages = load_document(file_path)
    if not pages:
        logger.debug(f"Skipping graph extraction for unsupported or empty file '{clean_fn}'")
        return

    parent_docs = get_parent_splitter().split_documents(pages)
    _run_knowledge_graph_pipeline(_sample_chunks(parent_docs), clean_fn, norm_uid)


ingest_pdf = ingest_file
