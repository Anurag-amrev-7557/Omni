"""API route modules package."""
from src.api.routes.health import router as health_router
from src.api.routes.sessions import router as sessions_router
from src.api.routes.documents import router as documents_router
from src.api.routes.chat import router as chat_router
from src.api.routes.pdf import router as pdf_router
from src.api.routes.github import router as github_router
from src.api.routes.graph import router as graph_router

__all__ = [
    "health_router",
    "sessions_router",
    "documents_router",
    "chat_router",
    "pdf_router",
    "github_router",
    "graph_router",
]
