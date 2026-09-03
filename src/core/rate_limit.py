"""In-memory thread-safe rate limiter with configurable sliding windows and per-user isolation."""
import threading
import time
from typing import Dict, List, Tuple
from fastapi import HTTPException

from src.config.settings import settings


class InMemoryRateLimiter:
    """Sliding-window per-user rate limiter."""

    def __init__(self):
        self._lock = threading.Lock()
        self._requests: Dict[Tuple[str, str], List[float]] = {}

    def get_limit(self, action: str) -> int:
        """Returns the configured request limit per minute for the specified action."""
        if action == "search":
            return getattr(settings, "RATE_LIMIT_SEARCH_PER_MINUTE", 15)
        return getattr(settings, "RATE_LIMIT_CHAT_PER_MINUTE", 30)

    def is_allowed(self, user_id: str, action: str = "chat", window_seconds: float = 60.0) -> Tuple[bool, int]:
        """Checks if a user has remaining quota in the current window."""
        if not getattr(settings, "RATE_LIMIT_ENABLED", True):
            return True, 0

        limit = self.get_limit(action)
        if limit <= 0:
            return True, 0

        now = time.time()
        window_start = now - window_seconds
        key = (user_id, action)

        with self._lock:
            history = [ts for ts in self._requests.get(key, []) if ts > window_start]
            if len(history) >= limit:
                self._requests[key] = history
                retry_after = max(1, int(history[0] + window_seconds - now) + 1)
                return False, retry_after

            history.append(now)
            self._requests[key] = history
            return True, 0

    def check_or_raise(self, user_id: str, action: str = "chat"):
        """Validates rate limit and raises HTTP 429 if exceeded."""
        allowed, retry_after = self.is_allowed(user_id=user_id, action=action)
        if allowed:
            return
        limit = self.get_limit(action)
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded for {action}. Limit is {limit} requests per minute. Try again in {retry_after}s.",
            headers={"Retry-After": str(retry_after)},
        )

    def reset(self):
        """Clears all stored rate limit history (useful for tests)."""
        with self._lock:
            self._requests.clear()


limiter = InMemoryRateLimiter()
