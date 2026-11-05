"""A real engine for the collaborator listing; the schema is expected at head."""

import pytest
import pytest_asyncio

from uniffy.infrastructure.database import close_db, init_db, open_session
from uniffy.infrastructure.database.session import get_database_url


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def database():
    try:
        await init_db(skip_migrations=True)
    except Exception as exc:
        pytest.skip(f"no database at {get_database_url()}: {exc}")
    try:
        yield
    finally:
        await close_db()


@pytest_asyncio.fixture(loop_scope="session")
async def session(database):
    async with open_session() as db_session:
        yield db_session
