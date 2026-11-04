import asyncio

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.types import generate_id
from uniffy.infrastructure.database.session import startup_advisory_lock

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_startup_lock_serializes_tasks_without_an_open_transaction(
    session: AsyncSession,
) -> None:
    lock_id = generate_id().int & ((1 << 63) - 1)
    entered = asyncio.Event()

    async def contender() -> None:
        async with startup_advisory_lock(lock_id, "test startup"):
            entered.set()

    async with startup_advisory_lock(lock_id, "test startup"):
        task = asyncio.create_task(contender())
        try:
            with pytest.raises(TimeoutError):
                await asyncio.wait_for(entered.wait(), 0.1)
            transactions = await session.execute(
                text(
                    "SELECT activity.xact_start FROM pg_locks locks "
                    "JOIN pg_stat_activity activity ON activity.pid = locks.pid "
                    "WHERE locks.locktype = 'advisory' AND locks.granted "
                    "AND locks.classid = :high AND locks.objid = :low"
                ),
                {"high": lock_id >> 32, "low": lock_id & ((1 << 32) - 1)},
            )
            assert transactions.all() == [(None,)]
        except BaseException:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            raise
    await asyncio.wait_for(task, 3)
    assert entered.is_set()


async def test_startup_lock_releases_after_failure(database: None) -> None:
    lock_id = generate_id().int & ((1 << 63) - 1)
    with pytest.raises(RuntimeError, match="startup failed"):
        async with startup_advisory_lock(lock_id, "test startup"):
            raise RuntimeError("startup failed")
    async with asyncio.timeout(3):
        async with startup_advisory_lock(lock_id, "test startup"):
            pass


@pytest.mark.parametrize("cancel_holder", [False, True])
async def test_cancelled_startup_does_not_leak_its_lock(database: None, cancel_holder: bool) -> None:
    lock_id = generate_id().int & ((1 << 63) - 1)
    entered = asyncio.Event()

    async def holder() -> None:
        async with startup_advisory_lock(lock_id, "test startup"):
            entered.set()
            await asyncio.Event().wait()

    task = asyncio.create_task(holder())
    try:
        await asyncio.wait_for(entered.wait(), 3)
        if not cancel_holder:
            waiter = asyncio.create_task(holder())
            await asyncio.sleep(0.1)
            waiter.cancel()
            with pytest.raises(asyncio.CancelledError):
                await waiter
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    async with asyncio.timeout(3):
        async with startup_advisory_lock(lock_id, "test startup"):
            pass
