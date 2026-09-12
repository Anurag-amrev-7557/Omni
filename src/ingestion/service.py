"""Document Ingestion Service: parsing, hierarchical chunking, and vector indexing."""
import os
import gc
import time
from typing import Optional, List, Dict, Any, Callable
from langchain_core.documents import Document
from langchain_qdrant import QdrantVectorStore

from src.config.settings import settings
from src.core.logging import logger
from src.core.security import normalize_user_id
from src.core.auth import get_current_user
from src.storage.vector_store import get_qdrant_client, init_db, invalidate_stats_cache
from src.retrieval.embeddings import get_embeddings
from src.ingestion.extractors import (
    SUPPORTED_EXTENSIONS,
    load_pages_with_pymupdf,
    load_pages_from_bytes,
    load_text_document,
    load_document,
    generate_summary,
)
from src.ingestion.chunking import split_hierarchical_chunks, get_parent_splitter
from src.graph.pipeline import extract_and_cluster



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

    if not filename and file_path:
        filename = os.path.basename(file_path)
    elif not filename:
        filename = "document.pdf"

    ext = os.path.splitext(filename)[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported file format '{ext}'. Supported: PDF, Markdown, Text, and Source Code files.")

    # 1. Document Page Extraction (Single-pass or reuse preloaded)
    if preloaded_pages is not None:
        pages = preloaded_pages
    elif file_bytes is not None:
        pages = load_pages_from_bytes(file_bytes, ext)
    elif ext == ".pdf":
        pages = load_pages_with_pymupdf(file_path)
    else:
        pages = load_text_document(file_path)

    if not pages:
        raise ValueError(f"No text content could be extracted from {filename}.")

    # 2. Executive Summary
    if generate_ai_summary and ext in {".pdf", ".md", ".txt"}:
        summary = generate_summary(pages)
    else:
        total_words = sum(len(p.page_content.split()) for p in pages)
        page_word = "page" if len(pages) == 1 else "pages"
        summary = f"{filename} ({len(pages)} {page_word}, ~{total_words:,} words)"

    # 3. Hierarchical Chunking
    if on_progress:
        on_progress("chunking", 30, f"Splitting {len(pages)} pages into semantic chunks...")

    parent_docs, child_documents = split_hierarchical_chunks(
        pages=pages,
        summary=summary,
        filename=filename,
        user_id=norm_uid,
    )

    # 4. Dense Vector Indexing with SIMD/Batched Vector Store Insertion
    if on_progress:
        on_progress("embedding", 60, f"Generating dense embeddings for {len(child_documents)} chunks...")

    embeddings_model = get_embeddings()
    client = get_qdrant_client()
    vector_store = QdrantVectorStore(
        client=client,
        collection_name=settings.COLLECTION_NAME,
        embedding=embeddings_model,
    )

    if on_progress:
        on_progress("indexing", 85, "Storing vectors in Qdrant collection...")

    logger.info(f"Indexing {len(child_documents)} child vectors for {filename} (user: {norm_uid})...")
    vector_store.add_documents(child_documents, batch_size=128)
    invalidate_stats_cache(user_id=norm_uid)

    elapsed_time = time.time() - start_time
    total_page_count = len(pages)
    total_chunk_count = len(child_documents)
    total_parents_count = len(parent_docs)

    # Sample parent chunks for knowledge graph extraction
    chunks_to_process = parent_docs if total_parents_count <= 6 else [
        parent_docs[int(i * (total_parents_count - 1) / 5)] for i in range(6)
    ]

    # Free vector memory early
    del child_documents, pages
    gc.collect()

    if on_progress:
        on_progress("completed", 100, f"Indexed successfully ({elapsed_time:.1f}s)")

    # 5. Optional Knowledge Graph Extraction
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


def _run_knowledge_graph_pipeline(chunks: List[Document], filename: str, user_id: str):
    """Encapsulates the knowledge graph entity/relation extraction and clustering pipeline."""
    try:
        extract_and_cluster(chunks, filename, user_id)
    except Exception as e:
        logger.warning(f"Graph extraction notice for {filename}: {e}")


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
        chunks_to_process = precomputed_chunks if len(precomputed_chunks) <= 6 else [
            precomputed_chunks[int(i * (len(precomputed_chunks) - 1) / 5)] for i in range(6)
        ]
        _run_knowledge_graph_pipeline(chunks_to_process, clean_fn, norm_uid)
        return

    if not file_path or not os.path.exists(file_path):
        logger.debug(f"Skipping graph extraction for missing file path '{clean_fn}'")
        return

    pages = load_document(file_path)
    if not pages:
        logger.debug(f"Skipping graph extraction for unsupported or empty file '{clean_fn}'")
        return

    parent_splitter = get_parent_splitter()
    parent_docs = parent_splitter.split_documents(pages)

    chunks_to_process = parent_docs if len(parent_docs) <= 6 else [
        parent_docs[int(i * (len(parent_docs) - 1) / 5)] for i in range(6)
    ]
    _run_knowledge_graph_pipeline(chunks_to_process, clean_fn, norm_uid)


# Backward-compatibility alias
ingest_pdf = ingest_file
