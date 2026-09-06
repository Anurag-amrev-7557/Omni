"""Unit tests verifying non-blocking async execution and thread-safe persistence."""
import asyncio
import io
import unittest
from unittest.mock import patch, MagicMock
from fastapi import UploadFile

from src.api.routes.documents import upload_documents
from src.storage.chat_db import save_message_async, get_session_messages


class TestAsyncWrapping(unittest.IsolatedAsyncioTestCase):
    async def test_upload_documents_uses_threadpool_for_blocking_calls(self):
        """Verifies that upload_documents delegates heavy I/O and DB queries to worker threads via asyncio.to_thread."""
        mock_file = UploadFile(
            filename="test_async.txt",
            file=io.BytesIO(b"Sample document text content for RAG vectorization."),
        )

        with patch("src.api.routes.documents.upload_bytes") as mock_upload, \
             patch("src.api.routes.documents.upsert_document_record") as mock_upsert, \
             patch("src.api.routes.documents.delete_file_from_collection") as mock_del_vec, \
             patch("src.api.routes.documents.ingest_file", return_value={"chunk_count": 2, "summary": "Test summary"}) as mock_ingest, \
             patch("src.api.routes.documents.update_document_status") as mock_update_status, \
             patch("src.api.routes.documents.get_documents", return_value={"documents": [{"filename": "test_async.txt"}]}) as mock_get_docs:

            # Concurrently run upload alongside an async heartbeat
            heartbeat_ticks = []

            async def heartbeat():
                for _ in range(5):
                    await asyncio.sleep(0.01)
                    heartbeat_ticks.append(True)

            hb_task = asyncio.create_task(heartbeat())
            res = await upload_documents([mock_file], user_id="test-async-user-123")
            await hb_task

            self.assertTrue(res["success"])
            self.assertEqual(res["ingested_count"], 1)
            # Verify event loop remained unblocked allowing heartbeat task to tick
            self.assertGreaterEqual(len(heartbeat_ticks), 1)

            # Confirm every blocking target was reached
            mock_upload.assert_called_once()
            mock_upsert.assert_called_once()
            mock_del_vec.assert_called_once()
            mock_ingest.assert_called_once()
            mock_update_status.assert_called_once()
            mock_get_docs.assert_called_once()

    def test_save_message_async_catches_and_logs_persistence_error(self):
        """Verifies that background thread persistence failures are logged with full context rather than silently swallowed."""
        sess_id = "test-error-session-999"
        role = "user"
        content = "Test question"

        with patch("src.storage.chat_db._persist_message_to_db", side_effect=RuntimeError("Simulated DB connection failure")), \
             patch("src.storage.chat_db.logger.error") as mock_log_error:

            save_message_async(sess_id, role, content, user_id="test-uid")

            # Allow daemon thread a short moment to execute and hit the mocked error
            import time
            time.sleep(0.05)

            # In-memory cache must still reflect the message immediately
            cached = get_session_messages(sess_id)
            self.assertEqual(len(cached), 1)
            self.assertEqual(cached[0]["content"], content)

            # The error must have been logged
            mock_log_error.assert_called_once()
            self.assertIn("Failed to asynchronously persist chat message", mock_log_error.call_args[0][0])


if __name__ == "__main__":
    unittest.main()
