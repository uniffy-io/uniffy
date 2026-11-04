"""Isolated empty databases exercise the migration chain from scratch."""

from collections.abc import AsyncIterator

import asyncpg
import pytest
import pytest_asyncio

from uniffy.core.types import generate_id
from uniffy.infrastructure.database.session import get_database_url


async def _maintenance_connection() -> asyncpg.Connection:
    return await asyncpg.connect(
        get_database_url().replace("postgresql+asyncpg://", "postgresql://", 1)
    )


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def database_reachable() -> None:
    try:
        conn = await _maintenance_connection()
        await conn.close()
    except asyncpg.PostgresError, OSError:
        pytest.skip("PostgreSQL is unavailable")


@pytest.fixture
async def scratch_database(
    database_reachable, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[str]:
    """Use the application's database configuration for each isolated migration run."""
    name = f"uniffy_migtest_{generate_id().hex}"
    conn = await _maintenance_connection()
    try:
        await conn.execute(f'CREATE DATABASE "{name}"')
    finally:
        await conn.close()

    monkeypatch.setenv("POSTGRES_DB", name)
    try:
        yield name
    finally:
        monkeypatch.undo()
        conn = await _maintenance_connection()
        try:
            await conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        finally:
            await conn.close()
