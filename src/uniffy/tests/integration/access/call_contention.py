"""Observe PostgreSQL lock waits before releasing competing call operations."""

import asyncio
from collections.abc import Awaitable, Callable, Sequence
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.infrastructure.database import open_session


async def wait_blocked(session: AsyncSession, pids: Sequence[int]) -> None:
    async with asyncio.timeout(10):
        while True:
            blockers = [
                await session.scalar(select(func.cardinality(func.pg_blocking_pids(pid))))
                for pid in pids
            ]
            if all(blockers):
                return
            await asyncio.sleep(0.01)


async def contend(
    lock: Any, operations: Sequence[Callable[[AsyncSession], Awaitable[Any]]]
) -> list[Any]:
    pids: list[int] = []
    ready = asyncio.Event()

    async def run(operation):
        async with open_session() as session:
            pids.append(await session.scalar(select(func.pg_backend_pid())))
            if len(pids) == len(operations):
                ready.set()
            return await operation(session)

    async with open_session() as holder:
        await holder.execute(lock)
        tasks = [asyncio.create_task(run(operation)) for operation in operations]
        try:
            await asyncio.wait_for(ready.wait(), 10)
            await wait_blocked(holder, pids)
            await holder.commit()
            return await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), 15)
        finally:
            await holder.rollback()
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
