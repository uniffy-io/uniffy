import asyncio
import gc
import weakref
from typing import Any
from unittest.mock import patch

import pytest
from prometheus_client import REGISTRY
from valkey.exceptions import ConnectionError as ValkeyConnectionError
from valkey.exceptions import TimeoutError as ValkeyTimeoutError

from uniffy.core.jobs import QueueName
from uniffy.infrastructure.valkey import pubsub, queue
from uniffy.vendor.arq import func
from uniffy.workers import runner
from uniffy.workers.metrics import WorkerRestartReason


class _Pipeline:
    """The startup INFO round trip, which answers before Valkey is lost."""

    def __init__(self) -> None:
        self.replies: list[Any] = []

    async def __aenter__(self) -> "_Pipeline":
        return self

    async def __aexit__(self, *exc: object) -> None:
        return None

    def info(self, section: str) -> None:
        self.replies.append({"valkey_version": "9.0.0"})

    def dbsize(self) -> None:
        self.replies.append(0)

    async def execute(self) -> list[Any]:
        return self.replies


class ValkeyPool:
    """The worker's queue connection: while ``lost`` holds an error, every command raises it."""

    def __init__(self, lost: Exception) -> None:
        self.lost: Exception | None = lost

    def pipeline(self, transaction: bool = True) -> _Pipeline:
        return _Pipeline()

    def _answer(self) -> None:
        if self.lost is not None:
            raise self.lost

    async def zrangebyscore(self, *args: Any, **kwargs: Any) -> list[bytes]:
        self._answer()
        return []

    async def zcard(self, *args: Any) -> int:
        self._answer()
        return 0

    async def psetex(self, *args: Any) -> None:
        self._answer()

    async def delete(self, *args: Any) -> None:
        self._answer()

    async def close(self, close_connection_pool: bool = False) -> None:
        return None


async def _unused(ctx: dict[str, Any]) -> None:
    return None


def fleet(pool: ValkeyPool, lifecycle: list[tuple[str, asyncio.AbstractEventLoop]]) -> type:
    """Worker settings whose hooks record the loop that opens and closes the process clients."""

    async def on_startup(ctx: dict[str, Any]) -> None:
        lifecycle.append(("startup", asyncio.get_running_loop()))

    async def on_shutdown(ctx: dict[str, Any]) -> None:
        lifecycle.append(("shutdown", asyncio.get_running_loop()))

    return type(
        "Fleet",
        (),
        {
            "functions": [func(_unused, name="unused")],
            "valkey_pool": pool,
            "burst": True,
            "handle_signals": False,
            "poll_delay": 0,
            "on_startup": on_startup,
            "on_shutdown": on_shutdown,
        },
    )


def restart_after(settings: type, pool: ValkeyPool, queue_name: QueueName) -> list[float]:
    """Run the fleet until it finishes; Valkey answers again during the restart backoff."""
    pauses: list[float] = []

    def backoff(seconds: float) -> None:
        pauses.append(seconds)
        pool.lost = None

    with (
        patch.object(runner, "configure_logging"),
        patch.object(runner, "start_worker_metrics_server"),
        patch.object(runner.time, "sleep", side_effect=backoff),
    ):
        runner.run_worker_with_restart(
            settings, app_name="test-worker", metrics_port=0, queue=queue_name
        )
    return pauses


def sample(name: str, labels: dict[str, str]) -> float:
    return REGISTRY.get_sample_value(name, labels) or 0.0


@pytest.mark.parametrize(
    ("lost", "queue_name", "reason"),
    [
        (ValkeyConnectionError("lost"), QueueName.CORE, WorkerRestartReason.VALKEY_CONNECTION),
        (
            ValkeyTimeoutError("Timeout reading from valkey:6379"),
            QueueName.EGRESS,
            WorkerRestartReason.VALKEY_CONNECTION,
        ),
        (ConnectionError("reset"), QueueName.MEDIA, WorkerRestartReason.CONNECTION),
    ],
)
def test_worker_restarted_after_losing_valkey_reopens_its_clients_on_a_fresh_loop(
    lost: Exception, queue_name: QueueName, reason: WorkerRestartReason
) -> None:
    restarts = {"queue": queue_name, "reason": reason}
    before = sample("uniffy_worker_restarts_total", restarts)
    pool = ValkeyPool(lost)
    lifecycle: list[tuple[str, asyncio.AbstractEventLoop]] = []

    pauses = restart_after(fleet(pool, lifecycle), pool, queue_name)

    # The lost run released its clients on their own loop before the restart opened new ones.
    assert [event for event, _ in lifecycle] == ["startup", "shutdown", "startup", "shutdown"]
    (_, first), (_, first_closer), (_, second), (_, second_closer) = lifecycle
    assert first_closer is first
    assert second is not first and second_closer is second
    assert first.is_closed() and second.is_closed()
    assert pauses == [1.0]
    assert sample("uniffy_worker_restarts_total", restarts) == before + 1
    assert sample("uniffy_worker_ready", {"queue": queue_name}) == 0


class QueuePool:
    """An ARQ pool that answers every command."""

    async def ping(self) -> bool:
        return True

    async def aclose(self, close_connection_pool: bool = False) -> None:
        return None


async def connecting_pool(*args: Any, **kwargs: Any) -> QueuePool:
    # Connecting yields, so a second caller waits for the reconnect already under way.
    await asyncio.sleep(0.01)
    return QueuePool()


def test_queue_reconnects_wait_their_turn_on_every_loop_a_restarted_worker_runs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(queue, "create_pool", connecting_pool)

    async def reconnect_twice() -> list[Any]:
        with pytest.raises(RuntimeError):
            queue.get_queue(QueueName.CORE)
        pools = await asyncio.gather(*(queue.get_queue_safe(QueueName.CORE) for _ in range(2)))
        await queue.close_queue(QueueName.CORE)
        return pools

    for _ in range(2):
        with asyncio.Runner() as restart:
            first, second = restart.run(reconnect_twice())
        assert first is not None and second is first


class Publisher:
    """The publisher connection; its ping yields, so concurrent publishes contend for it."""

    def __init__(self, published: list[tuple[str, bytes]]) -> None:
        self.published = published

    async def ping(self) -> bool:
        await asyncio.sleep(0.01)
        return True

    async def publish(self, channel: str, payload: bytes) -> None:
        self.published.append((channel, payload))

    async def aclose(self) -> None:
        return None


def test_publishes_wait_their_turn_on_every_loop_a_restarted_worker_runs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    published: list[tuple[str, bytes]] = []
    monkeypatch.setattr(pubsub.aioredis, "from_url", lambda url, **_: Publisher(published))

    async def publish_twice() -> None:
        await pubsub.init_pubsub()
        await asyncio.gather(pubsub.publish_bytes("doc", b"1"), pubsub.publish_bytes("doc", b"2"))
        await pubsub.close_pubsub()

    for _ in range(2):
        with asyncio.Runner() as restart:
            restart.run(publish_twice())

    assert sorted(published) == [("doc", b"1"), ("doc", b"1"), ("doc", b"2"), ("doc", b"2")]


def released(loops: list[weakref.ref[asyncio.AbstractEventLoop]]) -> list[bool]:
    gc.collect()
    return [loop() is None for loop in loops]


def test_a_restarted_worker_does_not_keep_the_loops_its_queue_reconnects_waited_on(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(queue, "create_pool", connecting_pool)
    loops: list[weakref.ref[asyncio.AbstractEventLoop]] = []

    async def reconnect_twice() -> None:
        loops.append(weakref.ref(asyncio.get_running_loop()))
        await asyncio.gather(*(queue.get_queue_safe(QueueName.CORE) for _ in range(2)))
        await queue.close_queue(QueueName.CORE)

    for _ in range(5):
        with asyncio.Runner() as restart:
            restart.run(reconnect_twice())

    # Only the latest loop may stay reachable, so a worker restarting on every lost connection
    # does not grow with each restart.
    assert released(loops)[:-1] == [True] * 4


def test_a_restarted_worker_does_not_keep_the_loops_its_publishes_waited_on(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    published: list[tuple[str, bytes]] = []
    monkeypatch.setattr(pubsub.aioredis, "from_url", lambda url, **_: Publisher(published))
    loops: list[weakref.ref[asyncio.AbstractEventLoop]] = []

    async def publish_twice() -> None:
        loops.append(weakref.ref(asyncio.get_running_loop()))
        await pubsub.init_pubsub()
        await asyncio.gather(pubsub.publish_bytes("doc", b"1"), pubsub.publish_bytes("doc", b"2"))
        await pubsub.close_pubsub()

    for _ in range(5):
        with asyncio.Runner() as restart:
            restart.run(publish_twice())

    assert len(published) == 10
    assert released(loops)[:-1] == [True] * 4
