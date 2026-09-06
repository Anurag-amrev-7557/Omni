"""Unit and integration tests for end-to-end trace ID generation and structured log propagation."""
import json
import logging
import io
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient

from src.api.app import app
from src.core.logging import trace_id_ctx, logger, StructuredJsonFormatter
from src.retrieval.service import hybrid_search
from src.generation.service import prepare_context_and_prompt
from src.graph.traversal import traverse_subgraph


class TestTraceIdPropagation(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        # Capture log records with StructuredJsonFormatter
        self.log_stream = io.StringIO()
        self.handler = logging.StreamHandler(self.log_stream)
        self.handler.setFormatter(StructuredJsonFormatter())
        logger.addHandler(self.handler)

    def tearDown(self):
        logger.removeHandler(self.handler)
        trace_id_ctx.set("")

    def test_trace_id_middleware_generates_and_returns_header(self):
        """Verifies that requests get assigned a trace ID and receive X-Request-ID in response."""
        res = self.client.get("/api/health")
        self.assertEqual(res.status_code, 200)
        self.assertIn("X-Request-ID", res.headers)
        self.assertTrue(len(res.headers["X-Request-ID"]) > 10)

    def test_trace_id_middleware_preserves_incoming_request_id(self):
        """Verifies that an incoming X-Request-ID header is preserved and echoed in the response."""
        custom_trace = "trace-custom-uuid-456789"
        res = self.client.get("/api/health", headers={"X-Request-ID": custom_trace})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers.get("X-Request-ID"), custom_trace)

    def test_end_to_end_trace_id_flows_through_route_retrieval_generation_and_graph(self):
        """Traces a query end-to-end to confirm the exact trace_id appears in every log line across all pipeline stages."""
        import time
        test_trace = "trace-pipeline-verify-abc123"

        with patch("src.retrieval.service.QdrantVectorStore"), \
             patch("src.retrieval.service.init_db"), \
             patch("src.retrieval.service.get_qdrant_client"), \
             patch("src.retrieval.service.get_embeddings"), \
             patch("src.generation.service.get_collection_stats", return_value={"files": ["contract.pdf"]}), \
             patch("src.graph.traversal.get_user_graph", return_value={"nodes": [], "links": []}), \
             patch("src.generation.service.stream_groq_with_fallback", return_value=iter(["Answer token."])):

            res = self.client.post(
                "/api/chat/stream",
                json={"session_id": "test-trace-session", "prompt": "What does section 3 state?"},
                headers={
                    "X-Request-ID": test_trace,
                    "X-Guest-Id": "test-user-trace",
                },
            )
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.headers.get("X-Request-ID"), test_trace)

            # Consume the full streaming response so the sse generator runs completely
            for _ in res.iter_lines():
                pass

            # Allow the daemon thread a brief instant to flush DB persistence logs
            time.sleep(0.05)

            # Parse captured log lines
            log_output = self.log_stream.getvalue().strip()
            log_lines = [json.loads(line) for line in log_output.split("\n") if line.strip().startswith("{")]

            # Verify that every log record produced during this trace carries the exact trace_id
            matching_records = [rec for rec in log_lines if rec.get("trace_id") == test_trace]
            self.assertGreaterEqual(len(matching_records), 5)

            messages = [r["message"] for r in matching_records]
            # 1. Route handler log
            self.assertTrue(any("Received chat stream request" in m for m in messages))
            # 2. Daemon thread persistence log
            self.assertTrue(any("Asynchronously persisting message" in m for m in messages))
            # 3. Generation stage log
            self.assertTrue(any("Preparing context and prompt" in m for m in messages))
            # 4. Hybrid retrieval log
            self.assertTrue(any("Executing hybrid search" in m for m in messages))
            # 5. Graph retrieval stage log
            self.assertTrue(any("Traversing knowledge graph" in m for m in messages))

            # Query consistency: every stage references the same query string
            for m in messages:
                if "query=" in m:
                    self.assertIn("What does section 3 state?", m)

    def test_daemon_thread_preserves_trace_id_on_persist_and_on_error(self):
        """Directly tests save_message_async to prove trace_id survives into background thread in both success and error paths."""
        import time
        from src.storage.chat_db import save_message_async

        daemon_trace = "trace-daemon-thread-998877"
        token = trace_id_ctx.set(daemon_trace)
        try:
            # 1. Success path
            save_message_async("sess-daemon-success", "user", "Hello daemon thread", user_id="uid-test")
            time.sleep(0.05)

            # 2. Error path in worker
            with patch("src.storage.chat_db._persist_message_to_db", side_effect=RuntimeError("Forced DB disconnect")):
                save_message_async("sess-daemon-error", "user", "Fail message", user_id="uid-test")
                time.sleep(0.05)
        finally:
            trace_id_ctx.reset(token)

        log_output = self.log_stream.getvalue().strip()
        records = [json.loads(line) for line in log_output.split("\n") if line.strip().startswith("{") and daemon_trace in line]

        # Verify trace_id was attached to records emitted from the background thread
        success_recs = [r for r in records if "Asynchronously persisting message" in r.get("message", "")]
        self.assertTrue(len(success_recs) >= 1)
        self.assertEqual(success_recs[0]["trace_id"], daemon_trace)

        error_recs = [r for r in records if "Failed to asynchronously persist chat message" in r.get("message", "")]
        self.assertTrue(len(error_recs) >= 1)
        self.assertEqual(error_recs[0]["trace_id"], daemon_trace)


if __name__ == "__main__":
    unittest.main()

