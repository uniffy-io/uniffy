from unittest.mock import AsyncMock, MagicMock

from uniffy.core.valkey.queue import QueueName
from uniffy.observability.metrics import (
    WORKER_JOB_START_DELAY,
    WORKER_JOB_REJECTED_TOTAL,
    WORKER_JOBS_COMPLETED_TOTAL,
    WORKER_JOBS_IN_PROGRESS,
    WORKER_JOBS_STARTED_TOTAL,
    WORKER_LAST_HEARTBEAT_TIMESTAMP,
    WORKER_QUEUE_DEPTH,
    WORKER_READY,
)
from uniffy.vendor.arq.constants import job_start_delay_ctx_key
from uniffy.vendor.arq.typing import JobRejectionReason
from uniffy.workers import lifecycle


def _patch_shared_resources(monkeypatch):
    functions = (
        "init_db",
        "init_s3",
        "init_meilisearch",
        "init_queue",
        "init_pubsub",
        "init_ops_client",
        "subscribe_dek_invalidations",
        "close_dek_invalidation_subscriber",
        "close_ops_client",
        "close_queue",
        "close_pubsub",
        "close_meilisearch",
        "close_s3",
        "close_db",
    )
    patched = {}
    for name in functions:
        mock = AsyncMock()
        monkeypatch.setattr(lifecycle, name, mock)
        patched[name] = mock
    return patched


async def test_core_lifecycle_opens_and_closes_its_runtime_resources(monkeypatch) -> None:
    resources = _patch_shared_resources(monkeypatch)
    adapter = AsyncMock()
    register_realtime = MagicMock()
    provision = AsyncMock()
    load_vapid = AsyncMock()
    monkeypatch.setattr(lifecycle, "provision_audit_partitions", provision)
    monkeypatch.setattr(lifecycle, "register_note_realtime_adapter", register_realtime)
    monkeypatch.setattr("uniffy.core.config.push.load_vapid_config", load_vapid)
    monkeypatch.setattr(
        "uniffy.domains.notifications.delivery.DELIVERY_ADAPTERS",
        {"test": adapter},
    )
    ctx = {}

    await lifecycle.core_on_startup(ctx)
    assert WORKER_READY.labels(queue=QueueName.CORE)._value.get() == 1
    await lifecycle.core_on_shutdown(ctx)

    assert ctx["queue"] is QueueName.CORE
    assert WORKER_READY.labels(queue=QueueName.CORE)._value.get() == 0
    resources["init_db"].assert_awaited_once_with(skip_migrations=True)
    register_realtime.assert_called_once_with()
    resources["init_queue"].assert_awaited_once_with(QueueName.CORE)
    load_vapid.assert_awaited_once_with()
    provision.assert_awaited_once_with(ctx)
    adapter.startup.assert_awaited_once_with()
    adapter.shutdown.assert_awaited_once_with()
    resources["close_queue"].assert_awaited_once_with(QueueName.CORE)
    resources["close_db"].assert_awaited_once_with()


async def test_egress_lifecycle_owns_provider_and_integration_subscribers(monkeypatch) -> None:
    resources = _patch_shared_resources(monkeypatch)
    provider_start = AsyncMock()
    provider_close = AsyncMock()
    integration_start = AsyncMock()
    integration_close = AsyncMock()
    monkeypatch.setattr(lifecycle, "init_provider_invalidation_subscriber", provider_start)
    monkeypatch.setattr(lifecycle, "close_provider_invalidation_subscriber", provider_close)
    monkeypatch.setattr(lifecycle, "init_integration_invalidation_subscriber", integration_start)
    monkeypatch.setattr(lifecycle, "close_integration_invalidation_subscriber", integration_close)
    ctx = {}

    await lifecycle.egress_on_startup(ctx)
    assert WORKER_READY.labels(queue=QueueName.EGRESS)._value.get() == 1
    await lifecycle.egress_on_shutdown(ctx)

    assert ctx["queue"] is QueueName.EGRESS
    assert WORKER_READY.labels(queue=QueueName.EGRESS)._value.get() == 0
    resources["init_queue"].assert_awaited_once_with(QueueName.EGRESS)
    provider_start.assert_awaited_once_with()
    integration_start.assert_awaited_once_with()
    provider_close.assert_awaited_once_with()
    integration_close.assert_awaited_once_with()
    resources["close_queue"].assert_awaited_once_with(QueueName.EGRESS)


async def test_job_lifecycle_records_attempt_state_and_start_delay() -> None:
    labels = {"queue": QueueName.CORE, "job_name": "test_worker_telemetry"}
    started = WORKER_JOBS_STARTED_TOTAL.labels(**labels)
    completed = WORKER_JOBS_COMPLETED_TOTAL.labels(**labels, status="success")
    in_progress = WORKER_JOBS_IN_PROGRESS.labels(**labels)
    start_delay = WORKER_JOB_START_DELAY.labels(**labels)
    before_started = started._value.get()
    before_completed = completed._value.get()
    before_in_progress = in_progress._value.get()
    before_delay = start_delay._sum.get()
    ctx = {
        "queue": QueueName.CORE,
        "job_name": labels["job_name"],
        "job_status": "success",
        job_start_delay_ctx_key: 250,
    }

    await lifecycle.on_job_start(ctx)

    assert started._value.get() == before_started + 1
    assert in_progress._value.get() == before_in_progress + 1
    assert start_delay._sum.get() == before_delay + 0.25

    await lifecycle.on_job_end(ctx)

    assert completed._value.get() == before_completed + 1
    assert in_progress._value.get() == before_in_progress


async def test_health_check_records_depth_and_success_timestamp() -> None:
    await lifecycle.on_health_check(
        {"queue": QueueName.EGRESS},
        queue_depth=17,
        heartbeat_timestamp=1_788_000_000.5,
    )

    assert WORKER_QUEUE_DEPTH.labels(queue=QueueName.EGRESS)._value.get() == 17
    assert (
        WORKER_LAST_HEARTBEAT_TIMESTAMP.labels(queue=QueueName.EGRESS)._value.get()
        == 1_788_000_000.5
    )


async def test_rejected_job_is_counted_without_changing_in_progress() -> None:
    reason = JobRejectionReason.FUNCTION_NOT_FOUND
    rejected = WORKER_JOB_REJECTED_TOTAL.labels(queue=QueueName.CORE, reason=reason)
    in_progress = WORKER_JOBS_IN_PROGRESS.labels(
        queue=QueueName.CORE,
        job_name="missing_handler",
    )
    before_rejected = rejected._value.get()
    before_in_progress = in_progress._value.get()

    await lifecycle.on_job_rejected(
        {
            "queue": QueueName.CORE,
            "job_name": "missing_handler",
        },
        reason=reason,
    )

    assert rejected._value.get() == before_rejected + 1
    assert in_progress._value.get() == before_in_progress
