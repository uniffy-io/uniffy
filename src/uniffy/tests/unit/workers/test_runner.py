from unittest.mock import patch

from valkey.exceptions import TimeoutError as ValkeyTimeoutError

from uniffy.core.jobs import QueueName
from uniffy.workers import runner
from uniffy.workers.metrics import (
    WORKER_READY,
    WORKER_RESTARTS_TOTAL,
    WorkerRestartReason,
)


def test_worker_runner_records_connection_restart_and_recovers() -> None:
    restart_counter = WORKER_RESTARTS_TOTAL.labels(
        queue=QueueName.CORE,
        reason=WorkerRestartReason.CONNECTION,
    )
    before_restarts = restart_counter._value.get()

    with (
        patch.object(runner, "configure_logging"),
        patch.object(runner, "start_worker_metrics_server"),
        patch.object(
            runner, "run_worker", side_effect=[ConnectionError("lost"), None]
        ) as run_worker,
        patch.object(runner.time, "sleep") as sleep,
    ):
        runner.run_worker_with_restart(
            object,
            app_name="test-worker",
            metrics_port=9191,
            queue=QueueName.CORE,
        )

    assert run_worker.call_count == 2
    sleep.assert_called_once_with(1.0)
    assert restart_counter._value.get() == before_restarts + 1
    assert WORKER_READY.labels(queue=QueueName.CORE)._value.get() == 0


def test_worker_runner_restarts_after_a_valkey_stall() -> None:
    restart_counter = WORKER_RESTARTS_TOTAL.labels(
        queue=QueueName.EGRESS, reason=WorkerRestartReason.VALKEY_CONNECTION
    )
    before_restarts = restart_counter._value.get()
    stall = ValkeyTimeoutError("Timeout reading from valkey:6379")

    with (
        patch.object(runner, "configure_logging"),
        patch.object(runner, "start_worker_metrics_server"),
        patch.object(runner, "run_worker", side_effect=[stall, None]) as run_worker,
        patch.object(runner.time, "sleep"),
    ):
        runner.run_worker_with_restart(
            object,
            app_name="test-worker",
            metrics_port=9191,
            queue=QueueName.EGRESS,
        )

    assert run_worker.call_count == 2
    assert restart_counter._value.get() == before_restarts + 1
