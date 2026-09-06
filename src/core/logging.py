"""Structured JSON logging with request tracing and context isolation."""
import json
import logging
import sys
import time
from contextvars import ContextVar
from typing import Optional

trace_id_ctx: ContextVar[str] = ContextVar("trace_id", default="")
user_id_ctx: ContextVar[str] = ContextVar("user_id", default="")


class StructuredJsonFormatter(logging.Formatter):
    """Outputs log records formatted as single-line JSON objects."""

    def format(self, record: logging.LogRecord) -> str:
        log_obj = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(record.created)),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if trace_id := trace_id_ctx.get():
            log_obj["trace_id"] = trace_id
        if user_id := user_id_ctx.get():
            log_obj["user_id"] = user_id
        if record.exc_info:
            log_obj["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_obj)


def get_logger(name: str = "omni") -> logging.Logger:
    """Returns a preconfigured logger instance."""
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(StructuredJsonFormatter())
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
    return logger


logger = get_logger("omni.rag")
