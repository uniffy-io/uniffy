import asyncio

import pytest

from uniffy.core.auth.permissions import batching
from uniffy.core.auth.permissions.batching import FreshAudience
from uniffy.core.types import generate_id


async def test_recipients_share_only_a_read_that_has_not_started() -> None:
    started, release = asyncio.Event(), asyncio.Event()
    calls = []
    allowed = True

    async def resolve(key, actors):
        calls.append((key, actors))
        result = dict.fromkeys(actors, allowed)
        started.set()
        await release.wait()
        return result

    batcher = FreshAudience(resolve)
    actors = [generate_id() for _ in range(20)]
    first = asyncio.gather(*(batcher.check("doc", actor) for actor in actors))
    await started.wait()
    allowed = False
    second = asyncio.create_task(batcher.check("doc", actors[0]))
    release.set()
    assert all(await first)
    assert await second is False
    assert len(calls) == 2
    assert calls[0][1] == actors
    assert await batcher.check("doc", actors[0]) is False
    assert len(calls) == 3


async def test_bounded_batches_survive_cancelled_recipients_and_database_failures() -> None:
    sizes = []
    fail = True

    async def resolve(key, actors):
        sizes.append(len(actors))
        if fail:
            raise OSError("database unavailable")
        return dict.fromkeys(actors, True)

    batcher = FreshAudience(resolve)
    actors = [generate_id() for _ in range(1000)]
    tasks = [asyncio.create_task(batcher.check("doc", actor)) for actor in actors]
    tasks[0].cancel()
    results = await asyncio.gather(*tasks, return_exceptions=True)
    assert isinstance(results[0], asyncio.CancelledError)
    assert all(isinstance(result, OSError) for result in results[1:])
    assert max(sizes) <= 256
    assert len(sizes) == 4
    fail = False
    assert await batcher.check("doc", actors[0]) is True


async def test_backpressure_bounds_database_concurrency_and_releases_queue(monkeypatch) -> None:
    monkeypatch.setattr(batching, "MAX_PENDING_RECIPIENTS", 16)
    monkeypatch.setattr(batching, "MAX_CONCURRENT_BATCHES", 2)
    release = asyncio.Event()
    started = asyncio.Event()
    active = 0
    peak = 0

    async def resolve(key, actors):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        if active == 2:
            started.set()
        await release.wait()
        active -= 1
        return dict.fromkeys(actors, True)

    batcher = FreshAudience(resolve)
    actor = generate_id()
    tasks = [asyncio.create_task(batcher.check(str(i), actor)) for i in range(16)]
    await started.wait()
    with pytest.raises(RuntimeError, match="queue full"):
        await batcher.check("overflow", actor)
    release.set()
    assert all(await asyncio.gather(*tasks))
    assert peak == 2
    assert await batcher.check("recovered", actor)
