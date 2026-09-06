"""Custom domain exceptions for Omni RAG workstation."""


class OmniException(Exception):
    """Base exception for all domain errors."""
    def __init__(self, message: str, status_code: int = 500, detail: dict | None = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.detail = detail or {}


class SecurityError(OmniException):
    """Raised when an unauthorized access or tenant isolation violation is detected."""
    def __init__(self, message: str = "Access denied: resource belongs to another user"):
        super().__init__(message, status_code=403)


class AuthenticationError(OmniException):
    """Raised when authentication credentials or JWT tokens are invalid or expired."""
    def __init__(self, message: str = "Invalid or expired authentication credentials"):
        super().__init__(message, status_code=401)


class DocumentNotFoundError(OmniException):
    """Raised when a requested document does not exist in the vault."""
    def __init__(self, filename: str):
        super().__init__(f"Document '{filename}' not found in Knowledge Vault", status_code=404)


class StorageError(OmniException):
    """Raised when file storage or vector store operations fail."""
    def __init__(self, message: str):
        super().__init__(message, status_code=502)


class LLMProviderError(OmniException):
    """Raised when upstream LLM inference providers fail or exceed rate limits."""
    def __init__(self, message: str):
        super().__init__(message, status_code=503)
