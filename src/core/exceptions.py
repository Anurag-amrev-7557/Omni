"""Custom domain exceptions for Omni RAG workstation."""


class OmniException(Exception):
    """Base domain exception for Omni workstation."""
    def __init__(self, message: str, status_code: int = 500, detail: dict | None = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.detail = detail or {}
