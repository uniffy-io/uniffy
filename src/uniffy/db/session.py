"""Database session management and initialization."""

import os
from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import asynccontextmanager

from alembic import command
from alembic.config import Config
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import AsyncAdaptedQueuePool
from sqlalchemy.sql import text

# Global engine and session maker
_engine: AsyncEngine | None = None
_async_session_maker: async_sessionmaker[AsyncSession] | None = None


def get_database_url() -> str:
    """
    Get the database URL from environment variables.

    Returns
    -------
    str
        The async PostgreSQL database URL.

    """
    db_host = os.getenv("POSTGRES_HOST", "localhost")
    db_port = os.getenv("POSTGRES_PORT", "5432")
    db_user = os.getenv("POSTGRES_USER", "uniffy")
    db_password = os.getenv("POSTGRES_PASSWORD", "uniffy")
    db_name = os.getenv("POSTGRES_DB", "uniffy")

    return f"postgresql+asyncpg://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"


async def create_extensions(engine: AsyncEngine) -> None:
    """
    Create necessary PostgreSQL extensions.

    Parameters
    ----------
    engine : AsyncEngine
        The SQLAlchemy async engine.

    """
    logger.info("Creating PostgreSQL extensions...")

    async with engine.begin() as conn:
        # Enable pg_trgm for fuzzy text search
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        logger.info("Extension pg_trgm enabled")

        # Enable uuid-ossp for UUID generation
        await conn.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'))
        logger.info("Extension uuid-ossp enabled")

        # Add more extensions as needed:
        # await conn.execute("CREATE EXTENSION IF NOT EXISTS vector")  # for pgvector


def run_migrations() -> None:
    """
    Run Alembic migrations to upgrade database to head.

    This function runs synchronously as Alembic doesn't support async natively.
    We use a synchronous connection URL for migrations.
    """
    logger.info("Running database migrations...")

    # Locate alembic.ini relative to this file (src/uniffy/db/session.py)
    # expected: src/uniffy/alembic.ini
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    alembic_cfg_path = os.path.join(base_dir, "alembic.ini")

    if not os.path.exists(alembic_cfg_path):
        raise FileNotFoundError(f"alembic.ini not found at {alembic_cfg_path}")

    alembic_cfg = Config(alembic_cfg_path)

    # Tell env.py to skip fileConfig - we use our own logging (loguru)
    alembic_cfg.attributes["configure_logger"] = False

    # Override the database URL to use synchronous driver for migrations
    db_host = os.getenv("POSTGRES_HOST", "localhost")
    db_port = os.getenv("POSTGRES_PORT", "5432")
    db_user = os.getenv("POSTGRES_USER", "uniffy")
    db_password = os.getenv("POSTGRES_PASSWORD", "uniffy")
    db_name = os.getenv("POSTGRES_DB", "uniffy")

    sync_url = f"postgresql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"
    alembic_cfg.set_main_option("sqlalchemy.url", sync_url)

    command.upgrade(alembic_cfg, "head")

    logger.info("Migrations completed successfully")


async def init_db(*, skip_migrations: bool = False) -> None:
    """
    Initialize the database.

    Creates extensions, optionally runs migrations, and sets up the global engine.
    This should be called on application startup.

    Parameters
    ----------
    skip_migrations : bool
        If True, skip running Alembic migrations. Useful for worker processes
        where migrations should only run from the main backend.

    """
    global _engine, _async_session_maker

    logger.info("Initializing database...")

    database_url = get_database_url()
    logger.info(f"Connecting to database: {database_url.split('@')[1]}")  # Log without password

    # Pool sizing (configurable via environment)
    pool_size = int(os.getenv("DB_POOL_SIZE", "10"))
    max_overflow = int(os.getenv("DB_MAX_OVERFLOW", "20"))
    pool_recycle_seconds = int(os.getenv("DB_POOL_RECYCLE", "1800"))
    pool_timeout_seconds = int(os.getenv("DB_POOL_TIMEOUT", "30"))

    # Per-connection timeouts and keepalive (asyncpg connect_args)
    statement_timeout_ms = int(os.getenv("DB_STATEMENT_TIMEOUT_MS", "30000"))
    command_timeout_seconds = int(os.getenv("DB_COMMAND_TIMEOUT", "30"))

    _engine = create_async_engine(
        database_url,
        echo=os.getenv("SQL_ECHO", "false").lower() == "true",
        poolclass=AsyncAdaptedQueuePool,
        pool_pre_ping=True,
        pool_size=pool_size,
        max_overflow=max_overflow,
        pool_recycle=pool_recycle_seconds,
        pool_timeout=pool_timeout_seconds,
        connect_args={
            # asyncpg connection-level timeout for each SQL statement
            "command_timeout": command_timeout_seconds,
            # TCP keepalive to detect dead connections through firewalls/LBs
            "server_settings": {
                "statement_timeout": str(statement_timeout_ms),
                "tcp_keepalives_idle": "60",
                "tcp_keepalives_interval": "10",
                "tcp_keepalives_count": "3",
            },
        },
    )

    # Expose pool stats to Prometheus gauges
    from uniffy.observability.metrics import register_db_pool

    register_db_pool(_engine.pool)

    # Create extensions before running migrations
    await create_extensions(_engine)

    # Run migrations (skip for workers - backend handles migrations)
    if not skip_migrations:
        run_migrations()

    # Create session maker
    _async_session_maker = async_sessionmaker(
        _engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    logger.info("Database initialized successfully")


async def get_async_session() -> AsyncGenerator[AsyncSession]:
    """
    Get an async database session (async generator form).

    Yields
    ------
    AsyncSession
        An async SQLAlchemy session.

    """
    if _async_session_maker is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")

    async with _async_session_maker() as session:
        try:
            yield session
        finally:
            await session.close()


@asynccontextmanager
async def open_session() -> AsyncIterator[AsyncSession]:
    """
    Open an async database session as a context manager.

    Use this instead of ``get_async_session`` in RPC handlers so the
    type checker can prove that the ``async with`` body always executes
    and the ``return`` inside it is guaranteed reachable::

        async with open_session() as session:
            ops = NoteOperations(session)
            note = await ops.create(...)
            return NoteResponse(note=note_to_proto(note))

    ``get_async_session`` is kept for FastAPI ``Depends`` callers and for
    background tasks that iterate explicitly; new handler code should
    prefer ``open_session``.
    """
    if _async_session_maker is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")

    async with _async_session_maker() as session:
        try:
            yield session
        finally:
            await session.close()


async def close_db() -> None:
    """Close the database engine and cleanup resources."""
    global _engine, _async_session_maker

    if _engine:
        logger.info("Closing database connection...")
        await _engine.dispose()
        _engine = None
        _async_session_maker = None
        logger.info("Database connection closed")
