"""Unit and regression tests for per-user rate limiting on chat and search endpoints."""
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient

from src.api.app import app
from src.config.settings import settings
from src.core.rate_limit import limiter, InMemoryRateLimiter


class TestRateLimiting(unittest.TestCase):
    def setUp(self):
        limiter.reset()
        self.client = TestClient(app)

    def tearDown(self):
        limiter.reset()

    def test_in_memory_limiter_isolated_per_user(self):
        """Validates that rate limits apply per user_id and do not leak across users."""
        test_limiter = InMemoryRateLimiter()
        user_a = "user-alpha-111"
        user_b = "user-beta-222"

        with patch.object(settings, "RATE_LIMIT_CHAT_PER_MINUTE", 2):
            # User A uses quota
            allowed, _ = test_limiter.is_allowed(user_a, action="chat")
            self.assertTrue(allowed)
            allowed, _ = test_limiter.is_allowed(user_a, action="chat")
            self.assertTrue(allowed)

            # User A 3rd request should fail
            allowed, retry_after = test_limiter.is_allowed(user_a, action="chat")
            self.assertFalse(allowed)
            self.assertGreater(retry_after, 0)

            # User B should be completely unaffected
            allowed_b, _ = test_limiter.is_allowed(user_b, action="chat")
            self.assertTrue(allowed_b)

    def test_api_chat_stream_returns_429_when_limit_exceeded(self):
        """Validates that exceeding the chat rate limit returns HTTP 429 while another user remains unaffected."""
        user_1 = "rate-test-user-1"
        user_2 = "rate-test-user-2"

        with patch.object(settings, "RATE_LIMIT_CHAT_PER_MINUTE", 2):
            # User 1 makes 2 requests
            for _ in range(2):
                res = self.client.post(
                    "/api/chat/stream",
                    json={"session_id": "test-sess", "prompt": "Hello"},
                    headers={"X-Guest-Id": user_1},
                )
                self.assertEqual(res.status_code, 200)

            # User 1 makes 3rd request -> Must receive 429
            res_exceeded = self.client.post(
                "/api/chat/stream",
                json={"session_id": "test-sess", "prompt": "Hello again"},
                headers={"X-Guest-Id": user_1},
            )
            self.assertEqual(res_exceeded.status_code, 429)
            self.assertIn("Rate limit exceeded for chat", res_exceeded.json()["detail"])
            self.assertIn("Retry-After", res_exceeded.headers)

            # User 2 makes a request -> Must succeed with 200
            res_user2 = self.client.post(
                "/api/chat/stream",
                json={"session_id": "test-sess-2", "prompt": "Hello from user 2"},
                headers={"X-Guest-Id": user_2},
            )
            self.assertEqual(res_user2.status_code, 200)

    def test_web_search_rate_limit_enforced_independently(self):
        """Validates that search limit triggers 429 when web_search=True is requested."""
        search_user = "search-rate-user"

        with patch.object(settings, "RATE_LIMIT_SEARCH_PER_MINUTE", 1):
            # 1st web search request succeeds
            res1 = self.client.post(
                "/api/chat/stream",
                json={"session_id": "test-sess", "prompt": "Search query", "web_search": True},
                headers={"X-Guest-Id": search_user},
            )
            self.assertEqual(res1.status_code, 200)

            # 2nd web search request fails with 429 for search action
            res2 = self.client.post(
                "/api/chat/stream",
                json={"session_id": "test-sess", "prompt": "Another search", "web_search": True},
                headers={"X-Guest-Id": search_user},
            )
            self.assertEqual(res2.status_code, 429)
            self.assertIn("Rate limit exceeded for search", res2.json()["detail"])


if __name__ == "__main__":
    unittest.main()
