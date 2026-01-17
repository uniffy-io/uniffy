"""Alembic environment configuration for migrations."""

import os
import sys
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool
from sqlmodel import SQLModel

# Add src to python path
sys.path.append(os.path.join(os.getcwd(), "src"))

# Import all models so they're registered with SQLModel.metadata
from uwos.core.models import *  # noqa: F403

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# Skip if running programmatically with our own logging (loguru via observability).
# When run via `alembic` CLI, configure_logger defaults to True.
if config.attributes.get("configure_logger", True) and config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
target_metadata = SQLModel.metadata


def get_url() -> str:
    """Get database URL from environment variables."""
    db_host = os.getenv("POSTGRES_HOST", "localhost")
    db_port = os.getenv("POSTGRES_PORT", "5432")
    db_user = os.getenv("POSTGRES_USER", "uwos")
    db_password = os.getenv("POSTGRES_PASSWORD", "uwos")
    db_name = os.getenv("POSTGRES_DB", "uwos")

    # Use synchronous driver for migrations
    return f"postgresql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"


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
    """
    Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.
    """
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        process_revision_directives=process_revision_directives,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode using synchronous connection."""
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = get_url()

    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            process_revision_directives=process_revision_directives,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
