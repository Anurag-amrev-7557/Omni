import os
import uuid
import concurrent.futures
import pymupdf
from langchain_community.document_loaders import TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document
from langchain_qdrant import QdrantVectorStore
try:
    from src.db import get_qdrant_client, init_db, delete_file_from_collection
    from src.config import COLLECTION_NAME
    from src.retrieve import get_embeddings
    from src.memory import reclaim_memory
except ImportError:
    from db import get_qdrant_client, init_db, delete_file_from_collection
    from config import COLLECTION_NAME
    from retrieve import get_embeddings
    from memory import reclaim_memory


def generate_summary(pages: list[Document]) -> str:
    """Generates a brief summary with strict 3-second timeout and heuristic fallback."""
    try:
        preview = "\n\n".join([p.page_content for p in pages[:2]])[:1200].strip()
        if not preview:
            return "Document knowledge excerpt."

        def _call_groq():
            try:
                from src.generate import invoke_groq_with_fallback
            except ImportError:
                from generate import invoke_groq_with_fallback
            prompt = f"Write a concise one-sentence title summary (max 15 words) for this document:\n\n{preview}"
            return invoke_groq_with_fallback(prompt)

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(_call_groq)
            res = future.result(timeout=3.0)
            if res and len(res.strip()) > 5:
                return res.strip().replace("\n", " ")
    except Exception as exc:
        print(f"[Ingest] Summary generation fallback: {exc}")

    # Fast heuristic fallback (first clean sentence or 120 chars)
    first_text = pages[0].page_content.strip()
    first_sentence = first_text.split(".")[0].strip().replace("\n", " ")
    if 10 < len(first_sentence) < 150:
        return f"{first_sentence}."
    return first_text[:120].strip().replace("\n", " ") or "Knowledge document excerpt."


def load_pages_with_pymupdf(file_path: str) -> list[Document]:
    """Loads PDF pages using PyMuPDF for high-fidelity text extraction with error resilience."""
    try:
        doc = pymupdf.open(file_path)
    except Exception as exc:
        raise ValueError(f"Could not open PDF file. The file may be damaged or password-protected: {exc}")

    pages = []
    try:
        for page_num in range(len(doc)):
            page = doc.load_page(page_num)
            text = page.get_text("text")
            if text and text.strip():
                pages.append(Document(page_content=text, metadata={"page": page_num + 1}))
    finally:
        doc.close()

    return pages


def ingest_file(file_path: str, user_id: str | None = None, progress_callback = None):
    init_db()
    
    # Ensure user_id is set for proper session-based operations
    if not user_id:
        try:
            from src.auth import get_current_user
            user_id = get_current_user()
        except ImportError:
            from auth import get_current_user
            user_id = get_current_user()
    
    filename = os.path.basename(file_path)
    ext = os.path.splitext(filename)[1].lower()
    
    print(f"[DEBUG] Starting ingestion for {filename} (type: {ext})")
    if progress_callback:
        progress_callback(15, "Parsing document pages...")
    
    if ext == ".pdf":
        pages = load_pages_with_pymupdf(file_path)
    elif ext in [".txt", ".md"]:
        try:
            loader = TextLoader(file_path, encoding="utf-8")
            pages = loader.load()
        except UnicodeDecodeError:
            loader = TextLoader(file_path, encoding="latin-1")
            pages = loader.load()
    else:
        raise ValueError(f"Unsupported file format '{ext}'. Only PDF, TXT, and MD are supported.")

    if not pages or not any(p.page_content.strip() for p in pages):
        raise ValueError(f"No extractable text found in '{filename}'. Scanned or empty documents are not supported.")
    
    print(f"[DEBUG] Extracted {len(pages)} pages from {filename}")
    if progress_callback:
        progress_callback(30, "Generating contextual summary...")
    summary = generate_summary(pages)
    print(f"[DEBUG] Generated summary: {summary[:100]}...")
    
    # 1. PARENT CHUNKING (1500 chars)
    if progress_callback:
        progress_callback(45, "Chunking document blocks...")
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
        
    if progress_callback:
        progress_callback(60, "Generating vector embeddings...")
    embeddings_model = get_embeddings()
    client = get_qdrant_client()
    
    # Clean deduplication: Remove any previous vectors for this file before re-inserting
    try:
        delete_file_from_collection(filename)
    except Exception as exc:
        print(f"[Ingest] Deduplication warning for {filename}: {exc}")

    # Clean knowledge graph data for this file before re-insertion
    try:
        from src.graph_db import delete_document_graph
        delete_document_graph(filename, user_id=user_id)
        print(f"[Ingest] Cleared existing graph data for {filename} (user: {user_id})")
    except Exception as g_exc:
        print(f"[Ingest] Graph cleanup warning for {filename}: {g_exc}")

    vector_store = QdrantVectorStore(
        client=client,
        collection_name=COLLECTION_NAME,
        embedding=embeddings_model,
    )
    
    # Batch vector indexing in chunks of 32 to avoid sharp FastEmbed / ONNX memory spikes on 512MB RAM
    CHUNK_BATCH_SIZE = 32
    total_children = len(child_documents)
    for i in range(0, total_children, CHUNK_BATCH_SIZE):
        batch = child_documents[i:i + CHUNK_BATCH_SIZE]
        vector_store.add_documents(batch)
        if progress_callback:
            pct = int(60 + (i / max(1, total_children)) * 16)
            progress_callback(pct, f"Indexing vectors ({min(i + CHUNK_BATCH_SIZE, total_children)}/{total_children})...")
        reclaim_memory()

    print(f"[DEBUG] Ingested {filename} into Qdrant: {len(parent_docs)} parent blocks, {len(child_documents)} child vectors.")
    print(f"[DEBUG] Collection name used: {COLLECTION_NAME}")

    # 3. KNOWLEDGE GRAPH EXTRACTION & COMMUNITY DETECTION
    try:
        from src.graph_extractor import extract_entities_and_relations
        from src.graph_clustering import run_community_detection_and_summaries
        from src.graph_db import run_entity_resolution_and_deduplication
        
        # Adaptively extract up to 6 parent blocks to ensure deep coverage across all pages
        total_parents = len(parent_docs)
        if total_parents <= 6:
            chunks_to_process = parent_docs
        else:
            # Pick representative blocks across beginning, middle, and end
            step = total_parents / 6.0
            indices = [int(i * step) for i in range(6)]
            chunks_to_process = [parent_docs[min(i, total_parents - 1)] for i in indices]

        entities_extracted = 0
        relations_extracted = 0
        
        for idx, parent in enumerate(chunks_to_process):
            chunk_pct = int(78 + (idx / max(1, len(chunks_to_process))) * 16)
            if progress_callback:
                progress_callback(chunk_pct, f"Extracting Knowledge Graph ({idx + 1}/{len(chunks_to_process)})...")
                
            result = extract_entities_and_relations(
                text=parent.page_content,
                filename=filename,
                page=parent.metadata.get("page", 1),
                user_id=user_id,
            )
            entities_extracted += len(result.get("entities", []))
            relations_extracted += len(result.get("relations", []))
        
        print(f"[Ingest] Extracted {entities_extracted} entities and {relations_extracted} relations from {filename}")
        
        # Run cross-document resolution so this file immediately links with existing entities in the graph
        run_entity_resolution_and_deduplication(user_id=user_id)

        # Only run community detection if this is a significant addition
        if entities_extracted > 2 or relations_extracted > 2:
            if progress_callback:
                progress_callback(96, "Detecting community clusters & themes...")
            run_community_detection_and_summaries(user_id=user_id)
            print(f"[Ingest] Updated community clusters after processing {filename}")
        else:
            print(f"[Ingest] Skipped community detection for small update ({entities_extracted} entities, {relations_extracted} relations)")
            
    except Exception as g_exc:
        print(f"[Ingest] Graph extraction notice for {filename}: {g_exc}")

    # Immediately invalidate both stats cache and user graph cache so UI reflects fresh data
    try:
        from src.db import invalidate_stats_cache
        from src.cache import invalidate_user_cache
        invalidate_stats_cache(user_id)
        invalidate_user_cache(user_id)
    except Exception:
        pass
    
    # Immediately reclaim memory to release RSS back to OS
    del child_documents
    del parent_docs
    del pages
    reclaim_memory()

    if progress_callback:
        progress_callback(100, "Completed")

# Backward compatibility alias
ingest_pdf = ingest_file
