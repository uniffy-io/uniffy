import asyncio
from typing import Any
from unittest.mock import patch

import pytest
from valkey.exceptions import ConnectionError as ValkeyConnectionError
from valkey.exceptions import TimeoutError as ValkeyTimeoutError

from uniffy.core.jobs import QueueName
from uniffy.vendor.arq import func
from uniffy.workers import runner
from uniffy.workers.metrics import (
    WORKER_READY,
    WORKER_RESTARTS_TOTAL,
    WorkerRestartReason,
)


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


def restart_after(settings: type, pool: ValkeyPool, queue: QueueName) -> list[float]:
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
        runner.run_worker_with_restart(settings, app_name="test-worker", metrics_port=0, queue=queue)
    return pauses


@pytest.mark.parametrize(
    ("lost", "queue", "reason"),
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
    lost: Exception, queue: QueueName, reason: WorkerRestartReason
) -> None:
    restarts = WORKER_RESTARTS_TOTAL.labels(queue=queue, reason=reason)
    before = restarts._value.get()
    pool = ValkeyPool(lost)
    lifecycle: list[tuple[str, asyncio.AbstractEventLoop]] = []

    pauses = restart_after(fleet(pool, lifecycle), pool, queue)

    # The lost run released its clients on their own loop before the restart opened new ones.
    assert [event for event, _ in lifecycle] == ["startup", "shutdown", "startup", "shutdown"]
    (_, first), (_, first_closer), (_, second), (_, second_closer) = lifecycle
    assert first_closer is first
    assert second is not first and second_closer is second
    assert first.is_closed() and second.is_closed()
    assert pauses == [1.0]
    assert restarts._value.get() == before + 1
    assert WORKER_READY.labels(queue=queue)._value.get() == 0
