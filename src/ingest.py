import os
import uuid
import time
from typing import Any, Callable
import pymupdf
from langchain_groq import ChatGroq
from langchain_core.documents import Document
from langchain_qdrant import QdrantVectorStore
try:
    from src.db import get_qdrant_client, init_db
    from src.config import COLLECTION_NAME
    from src.retrieve import get_embeddings
except ImportError:
    from db import get_qdrant_client, init_db
    from config import COLLECTION_NAME
    from retrieve import get_embeddings


def generate_summary(pages: list[Document]) -> str:
    try:
        from src.generate import invoke_groq_with_fallback
    except ImportError:
        from generate import invoke_groq_with_fallback
    preview = "\n\n".join([p.page_content for p in pages[:3]])
    prompt = f"Write a one-sentence summary of this document excerpt:\n\n{preview}"
    res = invoke_groq_with_fallback(prompt)
    return res if res else "Executive summary unavailable."


def load_pages_with_pymupdf(file_path: str) -> list[Document]:
    """Loads PDF pages using PyMuPDF for high-fidelity text extraction."""
    doc = pymupdf.open(file_path)
    pages = []
    for page_num in range(len(doc)):
        page = doc.load_page(page_num)
        text = page.get_text("text")
        if text.strip():
            pages.append(Document(page_content=text, metadata={"page": page_num + 1}))
    doc.close()
    return pages

def ingest_file(
    file_path: str,
    user_id: str | None = None,
    extract_graph: bool = False,
    generate_ai_summary: bool = False,
    on_progress: Any = None
):
    start_time = time.time()
    init_db()
    if on_progress:
        on_progress("reading", 10, "Extracting text content...")
    if not user_id:
        try:
            from src.auth import get_current_user
            user_id = get_current_user()
        except Exception:
            user_id = "default_user"

    filename = os.path.basename(file_path)
    ext = os.path.splitext(filename)[1].lower()
    
    TEXT_AND_CODE_EXTS = {
        ".txt", ".md", ".markdown", ".rst",
        ".py", ".ts", ".tsx", ".js", ".jsx", ".json",
        ".yaml", ".yml", ".go", ".rs", ".java", ".cpp",
        ".c", ".h", ".hpp", ".sql", ".sh", ".bash",
        ".css", ".scss", ".html", ".xml", ".toml"
    }

    if ext == ".pdf":
        pages = load_pages_with_pymupdf(file_path)
    elif ext in TEXT_AND_CODE_EXTS:
        from langchain_community.document_loaders import TextLoader
        loader = TextLoader(file_path, encoding="utf-8")
        pages = loader.load()
    else:
        raise ValueError(f"Unsupported file format '{ext}'. Supported: PDF, Markdown, Text, and Source Code files.")

    if not pages:
        raise ValueError(f"No text content could be extracted from {filename}.")
    
    # Generate summary - either AI-powered or simple metadata
    if generate_ai_summary and ext in {".pdf", ".md", ".txt"}:
        summary = generate_summary(pages)
    else:
        # Fast summary without LLM call
        total_words = sum(len(p.page_content.split()) for p in pages)
        page_word = "page" if len(pages) == 1 else "pages"
        summary = f"{filename} ({len(pages)} {page_word}, ~{total_words:,} words)"
    
    # 1. PARENT CHUNKING (1500 chars)
    if on_progress:
        on_progress("chunking", 30, f"Splitting {len(pages)} pages into semantic chunks...")
    from langchain_text_splitters import RecursiveCharacterTextSplitter
    parent_splitter = RecursiveCharacterTextSplitter(chunk_size=1500, chunk_overlap=200)
    parent_docs = parent_splitter.split_documents(pages)
    
    # 2. CHILD CHUNKING (300 chars) & PARENT-CHILD MAPPING
    child_splitter = RecursiveCharacterTextSplitter(chunk_size=300, chunk_overlap=50)
    child_documents = []
    
    child_count = 0
    for parent in parent_docs:
        parent_id = str(uuid.uuid4())
        page_num = parent.metadata.get("page", 1)
        raw_children = child_splitter.split_documents([parent])
        
        for child in raw_children:
            child_content = f"Document Context: {summary}\n\nChunk Excerpt:\n{child.page_content}"
            child_documents.append(
                Document(
                    page_content=child_content,
                    metadata={
                        "user_id": user_id,
                        "filename": filename,
                        "summary": summary,
                        "page": page_num,
                        "parent_id": parent_id,
                        "parent_content": parent.page_content,
                        "child_index": child_count
                    }
                )
            )
            child_count += 1
        
    if on_progress:
        on_progress("embedding", 60, f"Generating dense embeddings for {len(child_documents)} chunks...")
    embeddings_model = get_embeddings()
    client = get_qdrant_client()
    vector_store = QdrantVectorStore(
        client=client,
        collection_name=COLLECTION_NAME,
        embedding=embeddings_model,
    )
    
    if on_progress:
        on_progress("indexing", 85, f"Storing vectors in Qdrant collection...")
    print(f"[Ingest] Indexing {len(child_documents)} child vectors for {filename}...")
    vector_store.add_documents(child_documents)
    
    elapsed_time = time.time() - start_time
    print(f"[Ingest] ✓ Completed {filename} in {elapsed_time:.2f}s for user {user_id}: {len(parent_docs)} parent blocks, {len(child_documents)} child vectors.")

    if on_progress:
        on_progress("completed", 100, f"Indexed {len(child_documents)} chunks successfully ({elapsed_time:.1f}s)")

    # Knowledge Graph Extraction & Community Detection (opt-in or single document upload)
    if extract_graph:
        print(f"[Ingest] Running knowledge graph extraction for {filename} (this may take 10-20s)...")
        try:
            from src.graph_db import delete_document_graph, run_entity_resolution_and_deduplication
            from src.graph_extractor import extract_entities_and_relations
            from src.graph_clustering import run_community_detection_and_summaries

            delete_document_graph(filename, user_id=user_id)

            total_parents = len(parent_docs)
            chunks_to_process = parent_docs if total_parents <= 6 else [parent_docs[int(i * (total_parents - 1) / 5)] for i in range(6)]
            entities_extracted = 0
            relations_extracted = 0

            for parent in chunks_to_process:
                res = extract_entities_and_relations(
                    text=parent.page_content,
                    filename=filename,
                    page=parent.metadata.get("page", 1),
                    user_id=user_id,
                )
                entities_extracted += len(res.get("entities", []))
                relations_extracted += len(res.get("relations", []))

            run_entity_resolution_and_deduplication(user_id=user_id)
            if entities_extracted > 2 or relations_extracted > 2:
                run_community_detection_and_summaries(user_id=user_id)
            print(f"[Ingest] Knowledge Graph updated for {filename} (user: {user_id}): {entities_extracted} entities, {relations_extracted} relations.")
        except Exception as g_exc:
            print(f"[Ingest] Graph extraction notice for {filename}: {g_exc}")

# Backward compatibility alias
ingest_pdf = ingest_file


def extract_graph_for_file(file_path: str, filename: str | None = None, user_id: str | None = None):
    """Standalone background graph extraction — runs graph + AI summary without re-embedding.
    
    Called as a fire-and-forget background task after the fast upload path completes.
    Re-reads the file, chunks it, and runs entity/relation extraction + community detection.
    """
    import time as _time
    start = _time.time()
    
    if not filename:
        filename = os.path.basename(file_path)
    if not user_id:
        user_id = "default_user"

    ext = os.path.splitext(filename)[1].lower()

    TEXT_AND_CODE_EXTS = {
        ".txt", ".md", ".markdown", ".rst",
        ".py", ".ts", ".tsx", ".js", ".jsx", ".json",
        ".yaml", ".yml", ".go", ".rs", ".java", ".cpp",
        ".c", ".h", ".hpp", ".sql", ".sh", ".bash",
        ".css", ".scss", ".html", ".xml", ".toml"
    }

    # 1. Read file content (same logic as ingest_file)
    if ext == ".pdf":
        pages = load_pages_with_pymupdf(file_path)
    elif ext in TEXT_AND_CODE_EXTS:
        from langchain_community.document_loaders import TextLoader
        loader = TextLoader(file_path, encoding="utf-8")
        pages = loader.load()
    else:
        print(f"[AutoGraph] Skipping unsupported format '{ext}' for {filename}")
        return

    if not pages:
        print(f"[AutoGraph] No text content for {filename}, skipping graph extraction")
        return

    # 2. Chunk into parent blocks (same as ingest_file)
    from langchain_text_splitters import RecursiveCharacterTextSplitter
    parent_splitter = RecursiveCharacterTextSplitter(chunk_size=1500, chunk_overlap=200)
    parent_docs = parent_splitter.split_documents(pages)

    # 3. Run knowledge graph extraction
    try:
        from src.graph_db import delete_document_graph, run_entity_resolution_and_deduplication
        from src.graph_extractor import extract_entities_and_relations
        from src.graph_clustering import run_community_detection_and_summaries

        delete_document_graph(filename, user_id=user_id)

        total_parents = len(parent_docs)
        chunks_to_process = parent_docs if total_parents <= 6 else [parent_docs[int(i * (total_parents - 1) / 5)] for i in range(6)]
        entities_extracted = 0
        relations_extracted = 0

        for parent in chunks_to_process:
            res = extract_entities_and_relations(
                text=parent.page_content,
                filename=filename,
                page=parent.metadata.get("page", 1),
                user_id=user_id,
            )
            entities_extracted += len(res.get("entities", []))
            relations_extracted += len(res.get("relations", []))

        run_entity_resolution_and_deduplication(user_id=user_id)
        if entities_extracted > 2 or relations_extracted > 2:
            run_community_detection_and_summaries(user_id=user_id)

        elapsed = _time.time() - start
        print(f"[AutoGraph] ✓ {filename} graph built in {elapsed:.1f}s: {entities_extracted} entities, {relations_extracted} relations")
    except Exception as g_exc:
        print(f"[AutoGraph] Graph extraction failed for {filename}: {g_exc}")