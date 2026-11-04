"""PostgreSQL engine, migration, and session lifecycle."""

import asyncio
import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from alembic import command
from alembic.config import Config
from loguru import logger
from sqlalchemy import Connection
from sqlalchemy import exc as sa_exc
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import AsyncAdaptedQueuePool, NullPool
from sqlalchemy.sql import text

from uniffy.core.json_codec import dumps_str, loads
from uniffy.infrastructure.database.metrics import DB_POOL_TIMEOUT_TOTAL

logger = logger.bind(component="infrastructure.database.session")

# Stable 64-bit advisory-lock id for the infrastructure-owned startup step.
MIGRATION_LOCK_ID = 0x756E_6966_6679_4D31  # "unifyM1"

ALEMBIC_INI_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "alembic.ini"
)


@asynccontextmanager
async def startup_advisory_lock(lock_id: int, name: str) -> AsyncGenerator[None]:
    """Hold a dedicated session lock without blocking the event loop or concurrent DDL."""
    engine = create_async_engine(
        get_database_url(), poolclass=NullPool, isolation_level="AUTOCOMMIT"
    )
    try:
        async with engine.connect() as connection:
            attempt = 0
            while True:
                acquired = await connection.scalar(
                    text("SELECT pg_try_advisory_lock(:lock_id)"), {"lock_id": lock_id}
                )
                if acquired:
                    break
                attempt += 1
                if attempt == 1:
                    logger.info(
                        f"Another worker is running {name}, waiting for the lock",
                    )
                await asyncio.sleep(1)
            try:
                yield
            finally:
                await connection.execute(
                    text("SELECT pg_advisory_unlock(:lock_id)"), {"lock_id": lock_id}
                )
    finally:
        await engine.dispose()


_engine: AsyncEngine | None = None
_async_session_maker: async_sessionmaker[AsyncSession] | None = None


def get_database_url() -> str:
    db_host = os.getenv("POSTGRES_HOST", "localhost")
    db_port = os.getenv("POSTGRES_PORT", "5432")
    db_user = os.getenv("POSTGRES_USER", "uniffy")
    db_password = os.getenv("POSTGRES_PASSWORD", "uniffy")
    db_name = os.getenv("POSTGRES_DB", "uniffy")

    return f"postgresql+asyncpg://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"


async def create_extensions(engine: AsyncEngine) -> None:
    logger.info("Creating PostgreSQL extensions...")

    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        logger.info("Extension pg_trgm enabled")

        await conn.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'))
        logger.info("Extension uuid-ossp enabled")


async def run_migrations() -> None:
    logger.info("Running database migrations...")

    if not os.path.exists(ALEMBIC_INI_PATH):
        raise FileNotFoundError(f"alembic.ini not found at {ALEMBIC_INI_PATH}")

    alembic_cfg = Config(ALEMBIC_INI_PATH)

    # Skip fileConfig so loguru stays in charge.
    alembic_cfg.attributes["configure_logger"] = False

    def upgrade(connection: Connection) -> None:
        alembic_cfg.attributes["connection"] = connection
        command.upgrade(alembic_cfg, "head")

    engine = create_async_engine(
        get_database_url(),
        poolclass=NullPool,
        connect_args={"server_settings": {"TimeZone": "UTC"}},
    )
    try:
        async with (
            startup_advisory_lock(MIGRATION_LOCK_ID, "migrations"),
            engine.connect() as connection,
        ):
            await connection.run_sync(upgrade)
    finally:
        await engine.dispose()

    logger.info("Migrations completed successfully")


async def init_db(*, skip_migrations: bool = False, application_name: str = "uniffy") -> None:
    """Initialize database resources; workers skip migrations owned by backend startup."""
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
        json_serializer=dumps_str,
        json_deserializer=loads,
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
                "application_name": application_name,
                # Bare date/timestamp literals and date_trunc() resolve in the
                # session TimeZone; pin it so a non-UTC server default cannot
                # shift bucketing or partition bounds.
                "TimeZone": "UTC",
                "statement_timeout": str(statement_timeout_ms),
                # Short OLTP queries never recoup JIT compile time; a plan that
                # crosses jit_above_cost would pay a random compile spike.
                "jit": "off",
                "tcp_keepalives_idle": "60",
                "tcp_keepalives_interval": "10",
                "tcp_keepalives_count": "3",
            },
        },
    )

    from uniffy.infrastructure.database.metrics import register_db_pool

    register_db_pool(_engine.pool)

    await create_extensions(_engine)

    if not skip_migrations:
        await run_migrations()

    _async_session_maker = async_sessionmaker(
        _engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    logger.info("Database initialized successfully")


@asynccontextmanager
async def open_session() -> AsyncGenerator[AsyncSession]:
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
    global _engine, _async_session_maker

    if _engine:
        logger.info("Closing database connection...")
        await _engine.dispose()
        _engine = None
        _async_session_maker = None
        logger.info("Database connection closed")
