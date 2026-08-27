from unittest.mock import patch

from uniffy.core.valkey.queue import QueueName
from uniffy.observability.metrics import (
    WORKER_READY,
    WORKER_RESTARTS_TOTAL,
    WorkerRestartReason,
)
from uniffy.workers import runner


def test_worker_runner_records_connection_restart_and_recovers() -> None:
    restart_counter = WORKER_RESTARTS_TOTAL.labels(
        queue=QueueName.CORE,
        reason=WorkerRestartReason.CONNECTION,
    )
    before_restarts = restart_counter._value.get()

    with (
        patch.object(runner, "setup_observability"),
        patch.object(runner, "start_worker_metrics_server"),
        patch.object(runner, "run_worker", side_effect=[ConnectionError("lost"), None]) as run_worker,
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
