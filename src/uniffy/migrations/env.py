"""Alembic environment configuration for migrations."""

import asyncio
import os
import sys
from logging.config import fileConfig

from alembic import context
from sqlalchemy import Connection, pool
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel import SQLModel

# Add src to python path
sys.path.append(os.path.join(os.getcwd(), "src"))

# Import all models so they're registered with SQLModel.metadata
from uniffy.core.models import *  # noqa: F403
from uniffy.infrastructure.database.session import get_database_url

config = context.config

# Interpret the config file for Python logging.
# Skip if running programmatically with our own logging (loguru via observability).
# When run via `alembic` CLI, configure_logger defaults to True.
if config.attributes.get("configure_logger", True) and config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = SQLModel.metadata


def process_revision_directives(context, revision, directives):
    """Hook to set sequential revision IDs (001, 002, etc.)."""
    if config.get_main_option("revision_environment") == "true":
        script = directives[0]
        # Get the current head revision
        rev_dir = context.script
        head_rev = rev_dir.get_current_head()

        if head_rev is None:
            new_rev = 1
        else:
            try:
                new_rev = int(head_rev) + 1
            except ValueError:
                # Fallback if head is not a number
                new_rev = 1

        script.rev_id = f"{new_rev:03}"


def run_migrations_offline() -> None:
    """Emit migration SQL without connecting to PostgreSQL."""
    url = get_database_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        process_revision_directives=process_revision_directives,
    )

    with context.begin_transaction():
        context.run_migrations()


def apply_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        process_revision_directives=process_revision_directives,
        transaction_per_migration=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    engine = create_async_engine(
        get_database_url(),
        poolclass=pool.NullPool,
        # Migrations emit date literals against timestamptz columns; pin the
        # session zone so they resolve identically on any server default.
        connect_args={"server_settings": {"TimeZone": "UTC"}},
    )
    try:
        async with engine.connect() as connection:
            await connection.run_sync(apply_migrations)
    finally:
        await engine.dispose()


def run_migrations_online() -> None:
    connection = config.attributes.get("connection")
    if connection is None:
        asyncio.run(run_async_migrations())
    else:
        apply_migrations(connection)


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
