"""First-run setup on the live PostgreSQL: it waits for the bootstrap lock and stays closed."""

import asyncio
import threading
from collections.abc import AsyncIterator
from unittest.mock import MagicMock

import pytest
import pytest_asyncio
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import SetupAlreadyCompletedError
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.user import User
from uniffy.core.types import generate_id
from uniffy.domains.platform.bootstrap import BOOTSTRAP_LOCK_ID
from uniffy.domains.platform.setup import setup_deployment, setup_required
from uniffy.infrastructure.database.session import startup_advisory_lock

pytestmark = pytest.mark.asyncio(loop_scope="session")

_LOCK_WAIT_SECONDS = 0.5
_THREAD_TIMEOUT_SECONDS = 10.0


@pytest_asyncio.fixture(loop_scope="session")
async def existing_user(session: AsyncSession) -> AsyncIterator[User]:
    suffix = generate_id().hex[:12]
    user = User(email=f"setup-{suffix}@example.com", username=f"setup-{suffix}", is_active=True)
    user_id = user.id
    session.add(user)
    await session.commit()
    try:
        yield user
    finally:
        await session.rollback()
        await session.execute(delete(User).where(User.id == user_id))
        await session.commit()


async def _counts(session: AsyncSession) -> tuple[int, int]:
    users = (await session.execute(select(func.count()).select_from(User))).scalar_one()
    organizations = (
        await session.execute(select(func.count()).select_from(Organization))
    ).scalar_one()
    return users, organizations


def _attempt(email: str) -> asyncio.Task:
    return asyncio.create_task(
        setup_deployment(
            email=email,
            password="correct-horse-battery",
            full_name=None,
            organization_name=f"Setup {generate_id().hex[:8]}",
            organization_slug=None,
            user_agent="pytest",
            search_indexer=MagicMock(),
            call_lifecycle=MagicMock(),
        )
    )


async def test_setup_refuses_once_a_user_exists_and_writes_nothing(
    session: AsyncSession, existing_user: User
) -> None:
    del existing_user
    assert await setup_required(session) is False
    before = await _counts(session)
    email = f"operator-{generate_id().hex[:12]}@example.com"

    with pytest.raises(SetupAlreadyCompletedError):
        await _attempt(email)

    await session.rollback()
    assert await _counts(session) == before
    leaked = (await session.execute(select(User.id).where(User.email == email))).first()
    assert leaked is None


async def test_setup_waits_while_bootstrap_holds_its_lock(existing_user: User) -> None:
    del existing_user
    held = threading.Event()
    release = threading.Event()

    def hold_bootstrap_lock() -> None:
        with startup_advisory_lock(BOOTSTRAP_LOCK_ID, "deployment bootstrap"):
            held.set()
            release.wait(_THREAD_TIMEOUT_SECONDS)

    holder = threading.Thread(target=hold_bootstrap_lock, daemon=True)
    holder.start()
    try:
        assert await asyncio.to_thread(held.wait, _THREAD_TIMEOUT_SECONDS)
        attempt = _attempt(f"operator-{generate_id().hex[:12]}@example.com")
        await asyncio.sleep(_LOCK_WAIT_SECONDS)
        assert not attempt.done()
    finally:
        release.set()
        await asyncio.to_thread(holder.join, _THREAD_TIMEOUT_SECONDS)

    with pytest.raises(SetupAlreadyCompletedError):
        await asyncio.wait_for(attempt, _THREAD_TIMEOUT_SECONDS)
