"""Unified relational database connection management for PostgreSQL and SQLite."""
import os
import sqlite3
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
        if pool:
            try:
                pool.putconn(conn)
            except Exception:
                pass
        else:
            try:
                conn.close()
            except Exception:
                pass


def get_sqlite_connection(db_path: Optional[str] = None) -> sqlite3.Connection:
    """Creates a local SQLite connection with foreign keys and row factory enabled."""
    target_path = db_path or settings.CHAT_DB_PATH
    os.makedirs(os.path.dirname(os.path.abspath(target_path)), exist_ok=True)
    conn = sqlite3.connect(target_path, timeout=settings.DB_TIMEOUT)
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def get_db_cursor(commit: bool = False, db_path: Optional[str] = None):
    """Unified context manager yielding (conn, cursor, placeholder).

    Yields placeholder '%s' for PostgreSQL and '?' for SQLite.
    If commit=True, automatically commits before closing if no exception occurred.
    """
    with get_pg_connection() as pg_conn:
        if pg_conn is not None:
            cur = pg_conn.cursor()
            try:
                yield pg_conn, cur, "%s"
                if commit:
                    pg_conn.commit()
            except Exception:
                if commit:
                    try:
                        pg_conn.rollback()
                    except Exception:
                        pass
                raise
            finally:
                try:
                    cur.close()
                except Exception:
                    pass
            return

    sqlite_conn = get_sqlite_connection(db_path=db_path)
    cur = sqlite_conn.cursor()
    try:
        yield sqlite_conn, cur, "?"
        if commit:
            sqlite_conn.commit()
    except Exception:
        if commit:
            try:
                sqlite_conn.rollback()
            except Exception:
                pass
        raise
    finally:
        try:
            cur.close()
        except Exception:
            pass
        try:
            sqlite_conn.close()
        except Exception:
            pass
