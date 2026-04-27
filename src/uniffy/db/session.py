"""Database session management and initialization."""

import os
import time
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager, contextmanager

import psycopg2
from alembic import command
from alembic.config import Config
from loguru import logger
from sqlalchemy import exc as sa_exc
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import AsyncAdaptedQueuePool
from sqlalchemy.sql import text

from uniffy.observability.metrics import DB_POOL_TIMEOUT_TOTAL

# Stable 64-bit advisory-lock ids for the startup races we serialise across
# Granian workers (one Python process per WORKERS slot, all running lifespan in
# parallel). Each lock guards an idempotent step so late workers can drop in
# behind the leader without re-doing work. Add new ids here, never reuse.
MIGRATION_LOCK_ID = 0x756E_6966_6679_4D31  # "unifyM1"
SEED_LOCK_ID = 0x756E_6966_6679_5331  # "unifyS1"


def _build_sync_db_url() -> str:
    """Build the synchronous psycopg2 URL for tooling that cannot use asyncpg."""
    db_host = os.getenv("POSTGRES_HOST", "localhost")
    db_port = os.getenv("POSTGRES_PORT", "5432")
    db_user = os.getenv("POSTGRES_USER", "uniffy")
    db_password = os.getenv("POSTGRES_PASSWORD", "uniffy")
    db_name = os.getenv("POSTGRES_DB", "uniffy")
    return f"postgresql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"


@contextmanager
def startup_advisory_lock(lock_id: int, name: str) -> Iterator[None]:
    """Serialise a startup step across Granian workers / k8s replicas.

    Uses pg_try_advisory_lock + sleep-poll, NOT pg_advisory_lock. A blocking
    SELECT keeps a transaction open on the waiting connection, which deadlocks
    against migrations that use CREATE INDEX CONCURRENTLY (CONCURRENTLY waits
    for all open transactions to finish). Each try-probe is a one-shot
    autocommitted statement, so waiters do not hold transactions between
    attempts.

    The lock is released when the connection closes -- if a worker crashes
    mid-step Postgres reclaims the lock automatically and a follower takes
    over. The followed-by-step body must therefore be idempotent (re-checking
    "is this already done?" before doing it).

    Usage::

        with startup_advisory_lock(MY_LOCK_ID, "my step"):
            run_my_idempotent_step()
    """
    conn = psycopg2.connect(_build_sync_db_url())
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            attempt = 0
            while True:
                cur.execute(
                    "SELECT pg_try_advisory_lock(%s)",
                    (lock_id,),
                )
                if cur.fetchone()[0]:
                    break
                attempt += 1
                if attempt == 1:
                    logger.info(
                        f"Another worker is running {name}, waiting for the lock",
                    )
                time.sleep(1)
            try:
                yield
            finally:
                cur.execute(
                    "SELECT pg_advisory_unlock(%s)",
                    (lock_id,),
                )
    finally:
        conn.close()


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
    alembic_cfg.set_main_option("sqlalchemy.url", _build_sync_db_url())

    with startup_advisory_lock(MIGRATION_LOCK_ID, "migrations"):
        # Followers run upgrade(head) against an already-current schema --
        # Alembic emits no DDL, so the run is a fast no-op for them.
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


@asynccontextmanager
async def open_session() -> AsyncIterator[AsyncSession]:
    """
    Open an async database session as a context manager.

    Always use this to acquire a DB session in handlers, workers, and
    scripts::

        async with open_session() as session:
            ops = NoteOperations(session)
            note = await ops.create(...)
            return NoteResponse(note=note_to_proto(note))

    Context-manager cleanup (``__aexit__``) is awaited deterministically,
    so the pooled connection is always returned. The older
    ``async for session in get_async_session(): ...`` form has been removed
    because ``return`` / ``break`` inside the loop did not call ``aclose()``
    on the generator, leaving connections to be reclaimed by the garbage
    collector and triggering SAWarnings about non-checked-in connections.
    """
    if _async_session_maker is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")

    try:
        async with _async_session_maker() as session:
            yield session
    except sa_exc.TimeoutError:
        # Pool checkout exceeded DB_POOL_TIMEOUT. Re-raise so the caller
        # still surfaces the failure; the counter lets us alert on the
        # event as soon as it shows up on /metrics.
        DB_POOL_TIMEOUT_TOTAL.inc()
        raise


async def close_db() -> None:
    """Close the database engine and cleanup resources."""
    global _engine, _async_session_maker

    if _engine:
        logger.info("Closing database connection...")
        await _engine.dispose()
        _engine = None
        _async_session_maker = None
        logger.info("Database connection closed")
