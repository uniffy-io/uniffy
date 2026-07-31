"""Skip the suite when no Postgres is reachable.

These tests exercise domain operations against a real database: they seed an
org, provision its DEK, and clean up after themselves. Without a server they
fail with a connection error 49 times over, which says nothing useful, so the
whole suite skips instead.
"""

import asyncio

import pytest
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool
from sqlalchemy.sql import text

from uniffy.db.session import get_database_url


def _database_reachable() -> bool:
    async def probe() -> bool:
        engine = create_async_engine(get_database_url(), poolclass=NullPool)
        try:
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            return True
        except Exception:
            return False
        finally:
            await engine.dispose()

    return asyncio.run(probe())


def pytest_collection_modifyitems(config, items) -> None:
    if _database_reachable():
        return
    skip = pytest.mark.skip(reason=f"no database at {get_database_url()}")
    for item in items:
        item.add_marker(skip)
