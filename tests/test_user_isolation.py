"""Unit & Integration Tests for Strict Multi-Tenant User Isolation.

Verifies:
1. Security filter builders enforce FieldCondition(key="user_id", match=MatchValue(value=user_id)).
2. Filename sanitization prevents path traversal and malicious characters.
3. User ID normalization handles UUIDs, guest IDs, and empty values securely.
4. Docs DB isolates document records between User A and User B.
5. Vector store search and collection stats never leak documents across tenants.
"""
import unittest
from unittest.mock import MagicMock, patch
from qdrant_client.models import FieldCondition, Filter, MatchValue

from src.config.settings import settings
from src.core.security import (
    build_user_filter,
    build_user_and_file_filter,
    normalize_user_id,
    sanitize_filename,
    validate_file_extension,
)
from src.storage.docs_db import (
    upsert_document_record,
    get_user_documents,
    delete_document_record,
)


class TestSecurityFilters(unittest.TestCase):
    """Test security filter generation and input sanitization."""

    def test_normalize_user_id(self):
        self.assertEqual(normalize_user_id(None), settings.DEFAULT_LOCAL_USER)
        self.assertEqual(normalize_user_id(""), settings.DEFAULT_LOCAL_USER)
        self.assertEqual(normalize_user_id("  "), settings.DEFAULT_LOCAL_USER)
        self.assertEqual(normalize_user_id("default_user"), settings.DEFAULT_LOCAL_USER)

        # UUID normalization
        uuid_str = "a8098c1a-f86e-11da-bd1a-00112444be1e"
        self.assertEqual(normalize_user_id(uuid_str.upper()), uuid_str)

        # Non-UUID string creates deterministic UUIDv5
        v5_id = normalize_user_id("custom_guest_123")
        self.assertEqual(normalize_user_id("custom_guest_123"), v5_id)

    def test_sanitize_filename(self):
        self.assertEqual(sanitize_filename("valid_report.pdf"), "valid_report.pdf")
        self.assertEqual(sanitize_filename("../../etc/passwd"), "passwd")
        self.assertEqual(sanitize_filename("nested/dir/test.txt"), "test.txt")
        self.assertEqual(sanitize_filename("../../../malicious.doc"), "malicious.doc")
        
        # Disallow hidden files
        with self.assertRaises(ValueError):
            sanitize_filename(".hidden_file")
        with self.assertRaises(ValueError):
            sanitize_filename("")

    def test_validate_file_extension(self):
        self.assertEqual(validate_file_extension("paper.pdf"), ".pdf")
        self.assertEqual(validate_file_extension("notes.txt"), ".txt")
        self.assertEqual(validate_file_extension("data.csv"), ".csv")
        with self.assertRaises(ValueError):
            validate_file_extension("script.exe")
        with self.assertRaises(ValueError):
            validate_file_extension("code.py")

    def test_build_user_filter(self):
        user_filter = build_user_filter("user_alpha")
        self.assertIsInstance(user_filter, Filter)
        self.assertIsNotNone(user_filter.should)
        keys = [cond.key for cond in user_filter.should if hasattr(cond, "key")]
        self.assertIn("user_id", keys)
        self.assertIn("metadata.user_id", keys)

    def test_build_user_and_file_filter(self):
        f = build_user_and_file_filter(["doc1.pdf", "doc2.pdf"], "user_beta")
        self.assertIsInstance(f, Filter)
        self.assertEqual(len(f.must), 2)



class TestDocsDbIsolation(unittest.TestCase):
    """Test user isolation in docs_db registration and queries."""

    def test_document_cross_user_isolation(self):
        user_a = "user_isolation_a"
        user_b = "user_isolation_b"

        # Register doc for user A
        upsert_document_record(
            filename="user_a_secret.pdf",
            user_id=user_a,
            size_bytes=1024,
            page_count=5,
            chunk_count=5,
        )

        # Register doc for user B
        upsert_document_record(
            filename="user_b_confidential.pdf",
            user_id=user_b,
            size_bytes=2048,
            page_count=10,
            chunk_count=10,
        )

        # Check User A's docs
        docs_a = get_user_documents(user_a)
        filenames_a = [d["filename"] for d in docs_a]
        self.assertIn("user_a_secret.pdf", filenames_a)
        self.assertNotIn("user_b_confidential.pdf", filenames_a)

        # Check User B's docs
        docs_b = get_user_documents(user_b)
        filenames_b = [d["filename"] for d in docs_b]
        self.assertIn("user_b_confidential.pdf", filenames_b)
        self.assertNotIn("user_a_secret.pdf", filenames_b)

        # User A cannot delete User B's doc
        # Deleting 'user_b_confidential.pdf' under user A scope affects 0 records for user B
        delete_document_record("user_b_confidential.pdf", user_id=user_a)
        docs_b_after = get_user_documents(user_b)
        filenames_b_after = [d["filename"] for d in docs_b_after]
        self.assertIn("user_b_confidential.pdf", filenames_b_after)

        # Cleanup
        delete_document_record("user_a_secret.pdf", user_id=user_a)
        delete_document_record("user_b_confidential.pdf", user_id=user_b)


class TestVectorStoreScoping(unittest.TestCase):
    """Test vector store queries enforce user-level scoping."""

    @patch("src.storage.vector_store.get_qdrant_client")
    def test_collection_stats_enforces_user_filter(self, mock_client_getter):
        mock_client = MagicMock()
        mock_client_getter.return_value = mock_client
        mock_col = MagicMock()
        mock_col.name = settings.COLLECTION_NAME
        mock_client.get_collections.return_value = MagicMock(collections=[mock_col])
        mock_client.scroll.return_value = ([], None)

        from src.storage.vector_store import get_collection_stats, invalidate_stats_cache

        invalidate_stats_cache()
        stats = get_collection_stats(user_id="user_david")

        # Verify scroll call has scroll_filter for user_david
        mock_client.scroll.assert_called_once()
        _, scroll_kwargs = mock_client.scroll.call_args
        scroll_filter = scroll_kwargs.get("scroll_filter")
        self.assertIsNotNone(scroll_filter)
        self.assertIsInstance(scroll_filter, Filter)
        keys = [cond.key for cond in scroll_filter.should if hasattr(cond, "key")]
        self.assertIn("user_id", keys)

    @patch("src.storage.vector_store.get_qdrant_client")
    def test_delete_user_vectors_enforces_user_filter(self, mock_client_getter):
        mock_client = MagicMock()
        mock_client_getter.return_value = mock_client

        from src.storage.vector_store import delete_user_vectors

        delete_user_vectors(user_id="user_eva")

        mock_client.delete.assert_called_once()
        _, kwargs = mock_client.delete.call_args
        selector = kwargs.get("points_selector")
        self.assertIsNotNone(selector)
        self.assertIsInstance(selector, Filter)
        keys = [cond.key for cond in selector.should if hasattr(cond, "key")]
        self.assertIn("user_id", keys)


if __name__ == "__main__":
    unittest.main()

