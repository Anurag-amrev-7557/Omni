"""Unit tests for Qdrant payload index enforcement and PostgreSQL/SQLite documents column migration."""
import unittest
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


class TestQdrantPayloadAndDocsMigration(unittest.TestCase):
    def test_ensure_payload_indices_invokes_create_payload_index(self):
        """Verify that ensure_payload_indices creates keyword indexes for metadata and fields."""
        mock_client = MagicMock()
        ensure_payload_indices(client=mock_client, col_name="test_collection", force=True)

        created_fields = [call.kwargs.get("field_name") for call in mock_client.create_payload_index.call_args_list]
        self.assertIn("metadata.user_id", created_fields)
        self.assertIn("user_id", created_fields)
        self.assertIn("metadata.filename", created_fields)
        self.assertIn("filename", created_fields)

    def test_init_db_creates_indices_for_existing_collection(self):
        """Verify init_db still calls ensure_payload_indices even if the collection already exists."""
        from src.config.settings import settings
        mock_client = MagicMock()
        mock_col = MagicMock()
        mock_col.name = settings.COLLECTION_NAME
        mock_client.get_collections.return_value.collections = [mock_col]

        with patch("src.storage.vector_store.get_qdrant_client", return_value=mock_client):
            with patch("src.storage.vector_store.ensure_payload_indices") as mock_ensure:
                init_db()
                self.assertTrue(mock_ensure.called)

    def test_get_collection_stats_recovers_from_index_error(self):
        """Verify get_collection_stats catches Index required error, calls ensure_payload_indices, and retries."""
        from src.config.settings import settings
        mock_client = MagicMock()
        mock_col = MagicMock()
        mock_col.name = settings.COLLECTION_NAME
        mock_client.get_collections.return_value.collections = [mock_col]

        mock_client.scroll.side_effect = [
            Exception("Bad request: Index required but not found for 'user_id'"),
            ([], None),
        ]

        _stats_cache.clear()
        with patch("src.storage.vector_store.get_qdrant_client", return_value=mock_client):
            with patch("src.storage.vector_store.ensure_payload_indices") as mock_ensure:
                stats = get_collection_stats(user_id="test-user-123")
                self.assertTrue(mock_ensure.called)
                self.assertEqual(stats, {"total_chunks": 0, "files": []})

    def test_init_docs_db_sqlite_migration(self):
        """Verify init_docs_db runs without error on SQLite and creates all expected columns."""
        init_docs_db(force=True)
        docs = get_user_documents(user_id="test-user-123")
        self.assertIsInstance(docs, list)

    def test_format_doc_rows_includes_summary(self):
        """Verify _format_doc_rows formats summary correctly."""
        sample_row = [
            "report.pdf",
            1048576,
            5,
            "ready",
            "Q3 financial doc",
            12,
            None,
            None,
        ]
        formatted = _format_doc_rows([sample_row])
        self.assertEqual(len(formatted), 1)
        self.assertEqual(formatted[0]["filename"], "report.pdf")
        self.assertEqual(formatted[0]["size_mb"], 1.0)
        self.assertEqual(formatted[0]["pages"], 5)
        self.assertEqual(formatted[0]["status"], "ready")
        self.assertEqual(formatted[0]["summary"], "Q3 financial doc")
        self.assertEqual(formatted[0]["chunks"], 12)
        self.assertTrue(formatted[0]["indexed"])

    def test_upsert_document_record_fallback(self):
        """Verify upsert_document_record falls back to UPDATE/INSERT if ON CONFLICT fails."""
        from src.storage.docs_db import upsert_document_record, get_user_documents
        success = upsert_document_record(
            filename="fallback_test.pdf",
            user_id="test-user-fallback",
            size_bytes=2048,
            page_count=2,
            status="ready",
        )
        self.assertTrue(success)
        docs = get_user_documents(user_id="test-user-fallback")
        filenames = [d["filename"] for d in docs]
        self.assertIn("fallback_test.pdf", filenames)

    def test_get_documents_includes_qdrant_files_when_db_empty(self):
        """Verify get_documents returns documents confirmed in Qdrant stats even if db and local dirs are empty."""
        from src.api.routes.documents import get_documents
        with patch("src.api.routes.documents.get_collection_stats", return_value={"total_chunks": 5, "files": ["cloud_only.pdf"]}):
            with patch("src.api.routes.documents.get_user_documents", return_value=[]):
                with patch("src.api.routes.documents.get_user_uploads_dir", return_value="/nonexistent/dir"):
                    res = get_documents(user_id="test-user-qdrant")
                    filenames = [d["filename"] for d in res["documents"]]
                    self.assertIn("cloud_only.pdf", filenames)
                    doc = next(d for d in res["documents"] if d["filename"] == "cloud_only.pdf")
                    self.assertTrue(doc["indexed"])
                    self.assertEqual(doc["status"], "ready")

    def test_get_user_uploads_dir_fallback_on_inaccessible_path(self):
        """Verify get_user_uploads_dir gracefully falls back to /tmp when configured directory is invalid (e.g. /var/data)."""
        import os
        from src.storage.file_storage import get_user_uploads_dir
        with patch("src.config.settings.settings.UPLOADS_DIR", "/nonexistent_root_dir/never_exists/var/data"):
            with patch("src.config.settings.settings.ENVIRONMENT", "development"):
                resolved_dir = get_user_uploads_dir(user_id="test-user-inaccessible")
                self.assertTrue(os.path.isdir(resolved_dir))
                self.assertTrue(os.access(resolved_dir, os.W_OK))
                self.assertIn("rag_uploads", resolved_dir)

    def test_write_bytes_to_file_fallback(self):
        """Verify _write_bytes_to_file creates parent directories and falls back to /tmp if target is invalid."""
        import os
        from src.api.routes.documents import _write_bytes_to_file
        invalid_path = "/nonexistent_root_folder/never_exists/var/data/uploaded_docs/test_doc.txt"
        data = b"Hello world test content"
        saved_path = _write_bytes_to_file(invalid_path, data)
        self.assertTrue(os.path.isfile(saved_path))
        with open(saved_path, "rb") as f:
            self.assertEqual(f.read(), data)
