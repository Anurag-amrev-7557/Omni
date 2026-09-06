"""FastAPI application factory, middleware configuration, and router assembly."""
import os
import uuid
import asyncio
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from src.config.settings import settings
from src.core.logging import trace_id_ctx, logger
from src.core.exceptions import OmniException
from src.storage.vector_store import init_db
from src.storage.chat_db import init_chat_db
from src.storage.docs_db import init_docs_db
from src.api.routes import (
    health_router,
    sessions_router,
    documents_router,
    chat_router,
    pdf_router,
    github_router,
    graph_router,
)


def get_allowed_origins():
    """Dynamically configures CORS origins based on settings."""
    origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "https://omni-phi-jade.vercel.app",
        "https://omni-lufq.onrender.com",
    ]
    if frontend_url := settings.FRONTEND_URL.strip():
        origins.append(frontend_url)
        if not frontend_url.startswith("http://www.") and not frontend_url.startswith("https://www."):
            origins.append(frontend_url.replace("https://", "https://www."))
    return list(set(origins))


def get_allowed_origin_regex():
    return r"^https?://([a-zA-Z0-9_-]+\.)*(vercel\.app|onrender\.com|fly\.dev)(:[0-9]+)?$|^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?$"


def create_app() -> FastAPI:
    """Builds and configures the FastAPI application instance."""
    application = FastAPI(
        title="Omni Enterprise Agentic RAG Workstation",
        description="Production REST API for Context-Aware Document Research with Groq LPUs, Cross-Encoder Reranking, and Sidecar Verification.",
        version="2.0.0",
    )

    # Middleware
    @application.middleware("http")
    async def trace_id_middleware(request: Request, call_next):
        incoming_trace = request.headers.get("X-Request-ID") or request.headers.get("X-Trace-ID")
        trace_id = incoming_trace.strip() if incoming_trace and incoming_trace.strip() else str(uuid.uuid4())
        token = trace_id_ctx.set(trace_id)
        try:
            response = await call_next(request)
            response.headers["X-Request-ID"] = trace_id
            return response
        finally:
            trace_id_ctx.reset(token)

    application.add_middleware(
        CORSMiddleware,
        allow_origins=get_allowed_origins(),
        allow_origin_regex=get_allowed_origin_regex(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
        max_age=86400,
    )

    # Global Exception Handler
    @application.exception_handler(OmniException)
    async def omni_exception_handler(request: Request, exc: OmniException):
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.message, "error_type": exc.__class__.__name__, **exc.detail},
        )

    # Include Routers
    application.include_router(health_router)
    application.include_router(sessions_router)
    application.include_router(documents_router)
    application.include_router(chat_router)
    application.include_router(pdf_router)
    application.include_router(github_router)
    application.include_router(graph_router)

    # Startup event
    @application.on_event("startup")
    async def on_startup():
        def _initialize_backends():
            try:
                init_db()
            except Exception as e:
                logger.warning(f"Vector DB startup initialization notice: {e}")
            try:
                init_chat_db()
            except Exception as e:
                logger.warning(f"Chat DB startup initialization notice: {e}")
            try:
                init_docs_db()
            except Exception as e:
                logger.warning(f"Docs DB startup initialization notice: {e}")
            try:
                from src.retrieval.embeddings import get_embeddings
                emb = get_embeddings()
                emb.embed_query("warmup")
                logger.info("FastEmbed ONNX model pre-warmed successfully during startup.")
            except Exception as e:
                logger.warning(f"Embedding model pre-warming notice: {e}")

        asyncio.create_task(asyncio.to_thread(_initialize_backends))

    return application


app = create_app()
