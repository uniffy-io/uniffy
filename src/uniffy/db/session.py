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

logger = logger.bind(component="db.session")

# Stable 64-bit advisory-lock ids serialise idempotent startup steps across
# Granian workers. Add new ids here, never reuse.
MIGRATION_LOCK_ID = 0x756E_6966_6679_4D31  # "unifyM1"
SEED_LOCK_ID = 0x756E_6966_6679_5331  # "unifyS1"

ALEMBIC_INI_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "alembic.ini"
)


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
    """Serialise an idempotent startup step across workers.

    Uses pg_try_advisory_lock + sleep-poll rather than blocking pg_advisory_lock
    because the latter holds an open transaction, which deadlocks against
    migrations that use CREATE INDEX CONCURRENTLY. The body must be idempotent:
    if a worker crashes, Postgres reclaims the lock and a follower takes over.
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


_engine: AsyncEngine | None = None
_async_session_maker: async_sessionmaker[AsyncSession] | None = None


def get_database_url() -> str:
    """Return the async PostgreSQL URL from POSTGRES_* env vars."""
    db_host = os.getenv("POSTGRES_HOST", "localhost")
    db_port = os.getenv("POSTGRES_PORT", "5432")
    db_user = os.getenv("POSTGRES_USER", "uniffy")
    db_password = os.getenv("POSTGRES_PASSWORD", "uniffy")
    db_name = os.getenv("POSTGRES_DB", "uniffy")

    return f"postgresql+asyncpg://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"


async def create_extensions(engine: AsyncEngine) -> None:
    """Create the PostgreSQL extensions Uniffy depends on."""
    logger.info("Creating PostgreSQL extensions...")

    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        logger.info("Extension pg_trgm enabled")

        await conn.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'))
        logger.info("Extension uuid-ossp enabled")


def run_migrations() -> None:
    """Upgrade the database to head via Alembic (sync; asyncpg is not supported)."""
    logger.info("Running database migrations...")

    if not os.path.exists(ALEMBIC_INI_PATH):
        raise FileNotFoundError(f"alembic.ini not found at {ALEMBIC_INI_PATH}")

    alembic_cfg = Config(ALEMBIC_INI_PATH)

    # Skip fileConfig so loguru stays in charge.
    alembic_cfg.attributes["configure_logger"] = False

    alembic_cfg.set_main_option("sqlalchemy.url", _build_sync_db_url())

    with startup_advisory_lock(MIGRATION_LOCK_ID, "migrations"):
        command.upgrade(alembic_cfg, "head")

    logger.info("Migrations completed successfully")


async def init_db(*, skip_migrations: bool = False) -> None:
    """Initialise the engine, create extensions, and optionally run migrations.

    Workers pass ``skip_migrations=True`` so only the backend process upgrades
    the schema; advisory locks would already make this safe, but skipping
    avoids the alembic import cost on worker boot.
    """
    global _engine, _async_session_maker

    logger.info("Initializing database...")

    database_url = get_database_url()
    logger.info(f"Connecting to database: {database_url.split('@')[1]}")

    pool_size = int(os.getenv("DB_POOL_SIZE", "10"))
    max_overflow = int(os.getenv("DB_MAX_OVERFLOW", "20"))
    pool_recycle_seconds = int(os.getenv("DB_POOL_RECYCLE", "1800"))
    pool_timeout_seconds = int(os.getenv("DB_POOL_TIMEOUT", "30"))

    statement_timeout_ms = int(os.getenv("DB_STATEMENT_TIMEOUT_MS", "30000"))
    command_timeout_seconds = int(os.getenv("DB_COMMAND_TIMEOUT", "30"))

    _engine = create_async_engine(
        database_url,
        echo=os.getenv("SQL_ECHO", "false").lower() == "true",  # noqa: PLR2004
        poolclass=AsyncAdaptedQueuePool,
        pool_pre_ping=True,
        pool_size=pool_size,
        max_overflow=max_overflow,
        pool_recycle=pool_recycle_seconds,
        pool_timeout=pool_timeout_seconds,
        connect_args={
            "command_timeout": command_timeout_seconds,
            # TCP keepalive catches dead connections through firewalls/LBs.
            "server_settings": {
                # Bare date/timestamp literals and date_trunc() resolve in the
                # session TimeZone; pin it so a non-UTC server default cannot
                # shift bucketing or partition bounds.
                "TimeZone": "UTC",
                "statement_timeout": str(statement_timeout_ms),
                "tcp_keepalives_idle": "60",
                "tcp_keepalives_interval": "10",
                "tcp_keepalives_count": "3",
            },
        },
    )

    from uniffy.observability.metrics import register_db_pool

    register_db_pool(_engine.pool)

    await create_extensions(_engine)

    if not skip_migrations:
        run_migrations()

    _async_session_maker = async_sessionmaker(
        _engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    logger.info("Database initialized successfully")


@asynccontextmanager
async def open_session() -> AsyncIterator[AsyncSession]:
    """Yield an `AsyncSession` and guarantee deterministic checkin on exit."""
    if _async_session_maker is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")

    try:
        async with _async_session_maker() as session:
            yield session
    except sa_exc.TimeoutError:
        # Surface pool exhaustion on /metrics so alerts fire on first occurrence.
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
