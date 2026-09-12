"""Unit tests for Qdrant payload index enforcement and PostgreSQL/SQLite documents column migration."""
import pytest
from unittest.mock import MagicMock, patch
from src.storage.vector_store import (
    ensure_payload_indices,
    init_db,
    get_collection_stats,
    _stats_cache,
)
from src.storage.docs_db import (
    init_docs_db,
    get_user_documents,
    _format_doc_rows,
)


def test_ensure_payload_indices_invokes_create_payload_index():
    """Verify that ensure_payload_indices creates keyword indexes for metadata and fields."""
    mock_client = MagicMock()
    ensure_payload_indices(client=mock_client, col_name="test_collection", force=True)

    created_fields = [call.kwargs.get("field_name") for call in mock_client.create_payload_index.call_args_list]
    assert "metadata.user_id" in created_fields
    assert "user_id" in created_fields
    assert "metadata.filename" in created_fields
    assert "filename" in created_fields


def test_init_db_creates_indices_for_existing_collection():
    """Verify init_db still calls ensure_payload_indices even if the collection already exists."""
    from src.config.settings import settings
    mock_client = MagicMock()
    mock_col = MagicMock()
    mock_col.name = settings.COLLECTION_NAME
    mock_client.get_collections.return_value.collections = [mock_col]

    with patch("src.storage.vector_store.get_qdrant_client", return_value=mock_client):
        with patch("src.storage.vector_store.ensure_payload_indices") as mock_ensure:
            init_db()
            assert mock_ensure.called


def test_get_collection_stats_recovers_from_index_error():
    """Verify get_collection_stats catches Index required error, calls ensure_payload_indices, and retries."""
    from src.config.settings import settings
    mock_client = MagicMock()
    mock_col = MagicMock()
    mock_col.name = settings.COLLECTION_NAME
    mock_client.get_collections.return_value.collections = [mock_col]

    # First scroll raises 400 Bad Request index error, second returns empty
    mock_client.scroll.side_effect = [
        Exception("Bad request: Index required but not found for 'user_id'"),
        ([], None),
    ]

    _stats_cache.clear()
    with patch("src.storage.vector_store.get_qdrant_client", return_value=mock_client):
        with patch("src.storage.vector_store.ensure_payload_indices") as mock_ensure:
            stats = get_collection_stats(user_id="test-user-123")
            assert mock_ensure.called
            assert stats == {"total_chunks": 0, "files": []}


def test_init_docs_db_sqlite_migration():
    """Verify init_docs_db runs without error on SQLite and creates all expected columns."""
    init_docs_db(force=True)
    docs = get_user_documents(user_id="test-user-123")
    assert isinstance(docs, list)


def test_format_doc_rows_includes_summary():
    """Verify _format_doc_rows formats summary correctly."""
    sample_row = [
        "report.pdf",       # 0: filename
        1048576,            # 1: size_bytes (1 MB)
        5,                  # 2: page_count
        "ready",            # 3: status
        "Q3 financial doc", # 4: summary
        12,                 # 5: chunk_count
        None,               # 6: error
        None,               # 7: updated_at
    ]
    formatted = _format_doc_rows([sample_row])
    assert len(formatted) == 1
    assert formatted[0]["filename"] == "report.pdf"
    assert formatted[0]["size_mb"] == 1.0
    assert formatted[0]["pages"] == 5
    assert formatted[0]["status"] == "ready"
    assert formatted[0]["summary"] == "Q3 financial doc"
    assert formatted[0]["chunks"] == 12
    assert formatted[0]["indexed"] is True


def test_upsert_document_record_fallback():
    """Verify upsert_document_record falls back to UPDATE/INSERT if ON CONFLICT fails."""
    from src.storage.docs_db import upsert_document_record, get_user_documents
    success = upsert_document_record(
        filename="fallback_test.pdf",
        user_id="test-user-fallback",
        size_bytes=2048,
        page_count=2,
        status="ready",
    )
    assert success is True
    docs = get_user_documents(user_id="test-user-fallback")
    filenames = [d["filename"] for d in docs]
    assert "fallback_test.pdf" in filenames


def test_get_documents_includes_qdrant_files_when_db_empty():
    """Verify get_documents returns documents confirmed in Qdrant stats even if db and local dirs are empty."""
    from src.api.routes.documents import get_documents
    with patch("src.api.routes.documents.get_collection_stats", return_value={"total_chunks": 5, "files": ["cloud_only.pdf"]}):
        with patch("src.api.routes.documents.get_user_documents", return_value=[]):
            with patch("src.api.routes.documents.get_user_uploads_dir", return_value="/nonexistent/dir"):
                res = get_documents(user_id="test-user-qdrant")
                filenames = [d["filename"] for d in res["documents"]]
                assert "cloud_only.pdf" in filenames
                doc = next(d for d in res["documents"] if d["filename"] == "cloud_only.pdf")
                assert doc["indexed"] is True
                assert doc["status"] == "ready"


def test_get_user_uploads_dir_fallback_on_inaccessible_path():
    """Verify get_user_uploads_dir gracefully falls back to /tmp when configured directory is invalid (e.g. /var/data)."""
    import os
    from src.storage.file_storage import get_user_uploads_dir
    with patch("src.config.settings.settings.UPLOADS_DIR", "/nonexistent_root_dir/never_exists/var/data"):
        with patch("src.config.settings.settings.ENVIRONMENT", "development"):
            resolved_dir = get_user_uploads_dir(user_id="test-user-inaccessible")
            assert os.path.isdir(resolved_dir)
            assert os.access(resolved_dir, os.W_OK)
            assert "rag_uploads" in resolved_dir


def test_write_bytes_to_file_fallback():
    """Verify _write_bytes_to_file creates parent directories and falls back to /tmp if target is invalid."""
    import os
    from src.api.routes.documents import _write_bytes_to_file
    invalid_path = "/nonexistent_root_folder/never_exists/var/data/uploaded_docs/test_doc.txt"
    data = b"Hello world test content"
    saved_path = _write_bytes_to_file(invalid_path, data)
    assert os.path.isfile(saved_path)
    with open(saved_path, "rb") as f:
        assert f.read() == data


