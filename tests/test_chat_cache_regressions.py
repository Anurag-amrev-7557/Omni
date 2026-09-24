"""Regression tests for chat_db message cache eviction and conversational greeting routing."""
import unittest
from unittest.mock import patch, MagicMock
from collections import OrderedDict

from src.storage import chat_db
from src.generation.service import is_conversational_query, prepare_context_and_prompt, answer_query_stream


class TestChatCacheEvictionRegressions(unittest.TestCase):
    def setUp(self):
        with chat_db._cache_lock:
            chat_db._messages_cache.clear()

    def tearDown(self):
        with chat_db._cache_lock:
            chat_db._messages_cache.clear()

    def test_read_path_eviction_over_max_sessions(self):
        """Exercises the previously-buggy read path: cache misses across >500 sessions

        must evict oldest sessions so cache size never exceeds _MAX_CACHE_SESSIONS.
        """
        # Mock get_db_cursor so it returns a dummy row for each session query
        with patch("src.storage.chat_db.get_db_cursor") as mock_cursor_ctx:
            mock_conn = MagicMock()
            mock_cur = MagicMock()
            # Each execute fetchall returns 1 message: role='user', content='hello', contexts_json=None
            mock_cur.fetchall.return_value = [("user", "hello", None)]
            mock_cursor_ctx.return_value.__enter__.return_value = (mock_conn, mock_cur, "?")

            total_sessions = 520
            for i in range(total_sessions):
                sess_id = f"read_session_{i}"
                msgs = chat_db.get_session_messages(sess_id)
                self.assertEqual(len(msgs), 1)

            with chat_db._cache_lock:
                # Assert cache size strictly bounded to _MAX_CACHE_SESSIONS (500)
                self.assertEqual(len(chat_db._messages_cache), chat_db._MAX_CACHE_SESSIONS)
                # Oldest 20 sessions (0..19) should have been evicted
                for evicted_i in range(20):
                    self.assertNotIn(f"read_session_{evicted_i}", chat_db._messages_cache)
                # Most recent sessions should be present
                for recent_i in range(total_sessions - 20, total_sessions):
                    self.assertIn(f"read_session_{recent_i}", chat_db._messages_cache)

    def test_single_session_message_cap(self):
        """Asserts that a single session's cached message list never exceeds _MAX_MESSAGES_PER_SESSION (100)."""
        session_id = "cap_test_session"
        total_messages = 150

        with patch("src.storage.chat_db.get_db_cursor") as mock_cursor_ctx:
            mock_conn = MagicMock()
            mock_cur = MagicMock()
            # Return 150 messages from DB
            mock_cur.fetchall.return_value = [
                ("user" if j % 2 == 0 else "assistant", f"content_{j}", None)
                for j in range(total_messages)
            ]
            mock_cursor_ctx.return_value.__enter__.return_value = (mock_conn, mock_cur, "?")

            # 1. Read path caps to 100 most recent
            msgs = chat_db.get_session_messages(session_id)
            self.assertEqual(len(msgs), total_messages)  # Caller gets all DB messages

            with chat_db._cache_lock:
                cached = chat_db._messages_cache[session_id]
                self.assertEqual(len(cached), chat_db._MAX_MESSAGES_PER_SESSION)
                # Should keep the most recent 100 messages (content_50 to content_149)
                self.assertEqual(cached[0]["content"], "content_50")
                self.assertEqual(cached[-1]["content"], "content_149")

        # 2. Write path keeps session at cap
        with patch("src.storage.chat_db._persist_message_to_db"):
            chat_db.add_message(session_id, role="user", content="content_150")

            with chat_db._cache_lock:
                cached = chat_db._messages_cache[session_id]
                self.assertEqual(len(cached), chat_db._MAX_MESSAGES_PER_SESSION)
                self.assertEqual(cached[0]["content"], "content_51")
                self.assertEqual(cached[-1]["content"], "content_150")


class TestConversationalGreetingRegressions(unittest.TestCase):
    def test_conversational_query_detection(self):
        self.assertTrue(is_conversational_query("Hi"))
        self.assertTrue(is_conversational_query("hello"))
        self.assertTrue(is_conversational_query("Hey there"))
        self.assertTrue(is_conversational_query("Good morning!"))
        self.assertTrue(is_conversational_query("help"))
        self.assertTrue(is_conversational_query("thank you"))
        self.assertFalse(is_conversational_query("What is the revenue for Q3?"))
        self.assertFalse(is_conversational_query("Compare document A and document B"))
        # Compound greetings starting with hi/hello but containing substantive questions
        self.assertFalse(is_conversational_query("Hi, what does the contract say about indemnification?"))
        self.assertFalse(is_conversational_query("Hello, can you summarize the revenue figures?"))
        self.assertFalse(is_conversational_query("Hey, analyze this document for me please"))

    def test_compound_greeting_does_not_trigger_conversational_fallback(self):
        """A compound query starting with 'Hi' but containing a real question must not trigger greeting prompt."""
        with patch("src.generation.service.get_collection_stats", return_value={"files": ["contract.pdf"]}), \
             patch("src.generation.service.hybrid_search", return_value=[{"content": "Indemnification clause details", "filename": "contract.pdf", "page": 1}]):
            prompt, contexts = prepare_context_and_prompt("Hi, what does the contract say about indemnification?", user_id="test-user")
            self.assertIsNotNone(prompt)
            # Must NOT be the conversational greeting prompt
            self.assertNotIn("greeting or opening inquiry", prompt)
            # Must be the grounded RAG prompt containing the retrieved context
            self.assertIn("Indemnification clause details", prompt)
            self.assertEqual(len(contexts), 1)

    def test_greeting_prompt_generation_without_documents(self):
        with patch("src.generation.service.get_collection_stats", return_value={"files": []}), \
             patch("src.generation.service.hybrid_search", return_value=[]):
            prompt, contexts = prepare_context_and_prompt("Hi", user_id="test-user")
            self.assertIsNotNone(prompt)
            self.assertIn("greeting or opening inquiry", prompt)
            self.assertEqual(contexts, [])

    def test_answer_query_stream_prevents_double_retrieval(self):
        with patch("src.generation.service.prepare_context_and_prompt") as mock_prep:
            # If prepared_prompt is empty string "", answer_query_stream should NOT re-run prepare_context_and_prompt
            stream = answer_query_stream("query", prepared_prompt="")
            result = "".join(list(stream))
            self.assertIn("I couldn't find any relevant information", result)
            self.assertFalse(mock_prep.called)

            # If prepared_prompt is None, answer_query_stream should ALSO NOT re-run prepare_context_and_prompt
            stream_none = answer_query_stream("query", prepared_prompt=None)
            result_none = "".join(list(stream_none))
            self.assertIn("I couldn't find any relevant information", result_none)
            self.assertFalse(mock_prep.called)

    def test_empty_vault_general_query_prompt(self):
        with patch("src.generation.service.get_collection_stats", return_value={"files": []}):
            prompt, contexts = prepare_context_and_prompt("Explain quantum computing", user_id="test-user", web_search=False)
            self.assertIsNotNone(prompt)
            self.assertIn("There are currently no documents uploaded in the Knowledge Vault", prompt)
            self.assertIn("Explain quantum computing", prompt)
            self.assertEqual(contexts, [])

    def test_vault_meta_query_short_circuit(self):
        with patch("src.generation.service.get_collection_stats", return_value={"files": ["doc1.pdf", "doc2.pdf"]}):
            prompt, contexts = prepare_context_and_prompt("What documents are in the vault?", user_id="test-user")
            self.assertIsNotNone(prompt)
            self.assertIn("doc1.pdf", prompt)
            self.assertIn("doc2.pdf", prompt)
            self.assertEqual(contexts, [])
