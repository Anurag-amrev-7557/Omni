"""Hierarchical Parent-Child Semantic Chunking."""
import uuid
from typing import List, Tuple
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

from src.config.settings import settings


def get_parent_splitter() -> RecursiveCharacterTextSplitter:
    """Returns parent chunk splitter (default: 1500 characters, 200 overlap)."""
    return RecursiveCharacterTextSplitter(
        chunk_size=settings.PARENT_CHUNK_SIZE,
        chunk_overlap=settings.PARENT_CHUNK_OVERLAP,
    )


def get_child_splitter() -> RecursiveCharacterTextSplitter:
    """Returns child chunk splitter (default: 300 characters, 50 overlap)."""
    return RecursiveCharacterTextSplitter(
        chunk_size=settings.CHILD_CHUNK_SIZE,
        chunk_overlap=settings.CHILD_CHUNK_OVERLAP,
    )


def split_hierarchical_chunks(
    pages: List[Document],
    summary: str,
    filename: str,
    user_id: str,
) -> Tuple[List[Document], List[Document]]:
    """Splits document pages into hierarchical parent context blocks and fine-grained child vectors.

    Adaptive Behavior:
    - Single-page documents or concise briefs (<= 4,000 chars total) preserve full-page
      integrity as parent chunks to prevent splitting related sections across chunk borders.
    - Multi-page / large documents use recursive structural parent splitting (2,800 chars).
    - Child vectors are enriched with contextual document and page metadata (Anthropic pattern).

    Returns:
        (parent_docs, child_documents)
    """
    total_chars = sum(len(p.page_content) for p in pages)
    parent_splitter = get_parent_splitter()

    # Adaptive: Preserve whole pages if single page or brief document
    if len(pages) == 1 or total_chars <= 4000:
        parent_docs = []
        for p in pages:
            if len(p.page_content) <= 4500:
                parent_docs.append(Document(page_content=p.page_content, metadata=dict(p.metadata)))
            else:
                parent_docs.extend(parent_splitter.split_documents([p]))
    else:
        parent_docs = parent_splitter.split_documents(pages)

    child_splitter = get_child_splitter()
    child_documents = []

    child_count = 0
    for parent in parent_docs:
        parent_id = str(uuid.uuid4())
        page_num = parent.metadata.get("page", 1)
        raw_children = child_splitter.split_documents([parent])

        for child in raw_children:
            child_content = (
                f"Document: {filename} (Page {page_num})\n"
                f"Overview: {summary}\n\n"
                f"Content:\n{child.page_content}"
            )
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
                        "child_index": child_count,
                    },
                )
            )
            child_count += 1

    return parent_docs, child_documents
