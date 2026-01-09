"""Database session management and initialization."""

import logging
import os
from collections.abc import AsyncGenerator

from alembic import command
from alembic.config import Config
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.sql import text

logger = logging.getLogger(__name__)

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
    db_user = os.getenv("POSTGRES_USER", "uwos")
    db_password = os.getenv("POSTGRES_PASSWORD", "uwos")
    db_name = os.getenv("POSTGRES_DB", "uwos")

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

    # Locate alembic.ini relative to this file (src/uwos/db/session.py)
    # expected: src/uwos/alembic.ini
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    alembic_cfg_path = os.path.join(base_dir, "alembic.ini")

    if not os.path.exists(alembic_cfg_path):
        raise FileNotFoundError(f"alembic.ini not found at {alembic_cfg_path}")

    alembic_cfg = Config(alembic_cfg_path)

    # Override the database URL to use synchronous driver for migrations
    db_host = os.getenv("POSTGRES_HOST", "localhost")
    db_port = os.getenv("POSTGRES_PORT", "5432")
    db_user = os.getenv("POSTGRES_USER", "uwos")
    db_password = os.getenv("POSTGRES_PASSWORD", "uwos")
    db_name = os.getenv("POSTGRES_DB", "uwos")

    sync_url = f"postgresql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"
    alembic_cfg.set_main_option("sqlalchemy.url", sync_url)

    command.upgrade(alembic_cfg, "head")

    logger.info("Migrations completed successfully")


async def init_db() -> None:
    """
    Initialize the database.

    Creates extensions, runs migrations, and sets up the global engine.
    This should be called on application startup.
    """
    global _engine, _async_session_maker

    logger.info("Initializing database...")

    database_url = get_database_url()
    logger.info(f"Connecting to database: {database_url.split('@')[1]}")  # Log without password

    # Create async engine
    _engine = create_async_engine(
        database_url,
        echo=os.getenv("SQL_ECHO", "false").lower() == "true",
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
    )

    # Create extensions before running migrations
    await create_extensions(_engine)

    # Run migrations
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
    Get an async database session.

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


async def close_db() -> None:
    """Close the database engine and cleanup resources."""
    global _engine, _async_session_maker

    if _engine:
        logger.info("Closing database connection...")
        await _engine.dispose()
        _engine = None
        _async_session_maker = None
        logger.info("Database connection closed")
