import os
import uuid
import pymupdf
from langchain_community.document_loaders import TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_groq import ChatGroq
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_core.documents import Document
from langchain_qdrant import QdrantVectorStore
try:
    from src.db import get_qdrant_client, init_db
    from src.config import COLLECTION_NAME
except ImportError:
    from db import get_qdrant_client, init_db
    from config import COLLECTION_NAME


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

def ingest_file(file_path: str):
    init_db()
    filename = os.path.basename(file_path)
    ext = os.path.splitext(filename)[1].lower()
    
    if ext == ".pdf":
        pages = load_pages_with_pymupdf(file_path)
    elif ext in [".txt", ".md"]:
        loader = TextLoader(file_path, encoding="utf-8")
        pages = loader.load()
    else:
        raise ValueError(f"Unsupported file format '{ext}'. Only PDF, TXT, and MD are supported.")

    if not pages:
        raise ValueError(f"No text content could be extracted from {filename}.")
    
    summary = generate_summary(pages)
    
    # 1. PARENT CHUNKING (1500 chars)
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
        
    embeddings_model = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
    client = get_qdrant_client()
    vector_store = QdrantVectorStore(
        client=client,
        collection_name=COLLECTION_NAME,
        embedding=embeddings_model,
    )
    
    vector_store.add_documents(child_documents)
    print(f"Ingested {filename} into Qdrant: {len(parent_docs)} parent blocks, {len(child_documents)} child vectors.")

# Backward compatibility alias
ingest_pdf = ingest_file