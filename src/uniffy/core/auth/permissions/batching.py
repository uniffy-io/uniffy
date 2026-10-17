"""Coalesce waiting recipients before a fresh authorization read, never after it."""

import asyncio
from collections.abc import Awaitable, Callable, Hashable
from dataclasses import dataclass, field
from uuid import UUID
from weakref import WeakKeyDictionary

from uniffy.core.auth.permissions.scalar import MAX_AUTHORIZATION_ACTORS

MAX_PENDING_RECIPIENTS = 4096
MAX_CONCURRENT_BATCHES = 8


@dataclass
class _LoopState[K: Hashable, R]:
    pending: dict[K, list[tuple[UUID, asyncio.Future[R]]]] = field(default_factory=dict)
    slots: asyncio.Semaphore = field(
        default_factory=lambda: asyncio.Semaphore(MAX_CONCURRENT_BATCHES)
    )
    tasks: set[asyncio.Task] = field(default_factory=set)
    count: int = 0


class FreshAudience[K: Hashable, R]:
    def __init__(self, resolve: Callable[[K, list[UUID]], Awaitable[dict[UUID, R]]]) -> None:
        self._resolve = resolve
        self._loops: WeakKeyDictionary[asyncio.AbstractEventLoop, _LoopState[K, R]] = (
            WeakKeyDictionary()
        )

    async def check(self, key: K, actor_id: UUID) -> R:
        loop = asyncio.get_running_loop()
        state = self._loops.get(loop)
        if state is None:
            state = _LoopState()
            self._loops[loop] = state
        if state.count >= MAX_PENDING_RECIPIENTS:
            raise RuntimeError("Authorization recipient queue full")
        future: asyncio.Future[R] = loop.create_future()
        batch = state.pending.get(key)
        if batch is None:
            batch = []
            state.pending[key] = batch
            task = loop.create_task(self._flush(state, key, batch))
            state.tasks.add(task)
            task.add_done_callback(state.tasks.discard)
        batch.append((actor_id, future))
        state.count += 1
        if len(batch) == MAX_AUTHORIZATION_ACTORS:
            del state.pending[key]
        return await future

    async def _flush(
        self,
        state: _LoopState[K, R],
        key: K,
        batch: list[tuple[UUID, asyncio.Future[R]]],
    ) -> None:
        try:
            async with state.slots:
                # Seal before I/O. Later disclosures must start another database read.
                if state.pending.get(key) is batch:
                    del state.pending[key]
                actors = list(dict.fromkeys(actor for actor, future in batch if not future.done()))
                if actors:
                    results = await self._resolve(key, actors)
                    for actor, future in batch:
                        if not future.done():
                            future.set_result(results[actor])
        except asyncio.CancelledError:
            for _, future in batch:
                future.cancel()
            raise
        except Exception as exc:
            for _, future in batch:
                if not future.done():
                    future.set_exception(exc)
        finally:
            if state.pending.get(key) is batch:
                del state.pending[key]
            state.count -= len(batch)
