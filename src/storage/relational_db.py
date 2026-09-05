"""Unified relational database connection management for PostgreSQL and SQLite."""
import os
import sqlite3
import threading
from typing import Optional
from contextlib import contextmanager

from src.config.settings import settings
from src.core.logging import logger

_pg_pool = None


def get_pg_pool():
    """Initializes and returns PostgreSQL ThreadedConnectionPool singleton."""
    global _pg_pool
    if _pg_pool is not None:
        return _pg_pool

    pg_url = settings.get_effective_postgres_url()
    if not pg_url:
        return None

    try:
        import psycopg2.pool
        _pg_pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=settings.DB_POOL_MIN,
            maxconn=settings.DB_POOL_MAX,
            dsn=pg_url,
        )
        logger.info("Initialized PostgreSQL connection pool")
    except Exception as e:
        logger.warning(f"PostgreSQL pool notice: {e}. Relational storage will use SQLite.")
        _pg_pool = None

    return _pg_pool


@contextmanager
def get_pg_connection():
    """Context manager for acquiring and releasing PostgreSQL connection from pool."""
    pool = get_pg_pool()
    conn = None
    if pool:
        try:
            conn = pool.getconn()
        except Exception as e:
            logger.debug(f"Pool getconn notice: {e}")

    if conn is None:
        pg_url = settings.get_effective_postgres_url()
        if pg_url:
            try:
                import psycopg2
                conn = psycopg2.connect(pg_url, connect_timeout=int(settings.DB_TIMEOUT))
            except Exception as e:
                logger.debug(f"Direct psycopg2 connection notice: {e}")
                conn = None

    if conn is None:
        yield None
        return

    try:
        yield conn
    finally:
        try:
            if pool:
                pool.putconn(conn)
            else:
                conn.close()
        except Exception:
            pass


_local = threading.local()


def get_sqlite_connection(db_path: Optional[str] = None) -> sqlite3.Connection:
    """Returns or creates a thread-local SQLite connection with WAL mode, normal sync, and 64MB memory cache."""
    target_path = os.path.abspath(db_path or settings.CHAT_DB_PATH)
    if not hasattr(_local, "connections"):
        _local.connections = {}

    conn = _local.connections.get(target_path)
    if conn is None:
        os.makedirs(os.path.dirname(target_path), exist_ok=True)
        conn = sqlite3.connect(target_path, timeout=settings.DB_TIMEOUT, check_same_thread=False)
        conn.execute("PRAGMA foreign_keys = ON;")
        try:
            conn.execute("PRAGMA journal_mode = WAL;")
            conn.execute("PRAGMA synchronous = NORMAL;")
            conn.execute("PRAGMA cache_size = -64000;")
            conn.execute("PRAGMA temp_store = MEMORY;")
        except Exception:
            pass
        conn.row_factory = sqlite3.Row
        _local.connections[target_path] = conn

    return conn


@contextmanager
def get_db_cursor(commit: bool = False, db_path: Optional[str] = None):
    """Unified context manager yielding (conn, cursor, placeholder).

    Yields placeholder '%s' for PostgreSQL and '?' for SQLite.
    Reuses thread-local SQLite connections for microsecond query dispatch.
    If commit=True, automatically commits before yielding if no exception occurred.
    """
    with get_pg_connection() as pg_conn:
        is_pg = pg_conn is not None
        conn = pg_conn if is_pg else get_sqlite_connection(db_path=db_path)
        cur = conn.cursor()
        p = "%s" if is_pg else "?"
        try:
            yield conn, cur, p
            if commit:
                conn.commit()
        except Exception:
            if commit:
                try:
                    conn.rollback()
                except Exception:
                    pass
            raise
        finally:
            try:
                cur.close()
            except Exception:
                pass
