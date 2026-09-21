from contextlib import AsyncExitStack
from dataclasses import replace
from unittest.mock import AsyncMock, MagicMock

from uniffy.core.database import SESSION_FACTORY_CTX_KEY
from uniffy.core.search import SEARCH_INDEXER_CTX_KEY, WORKSPACE_SEARCH_CTX_KEY
from uniffy.core.jobs import QueueName
from uniffy.domains.files.jobs.slots import MEDIA_SLOTS_CTX_KEY
from uniffy.domains.files.jobs import slots as slots_mod
from uniffy.domains.notifications.delivery import DELIVERY_ADAPTERS_CTX_KEY
from uniffy.workers.metrics import (
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
    monkeypatch.setattr(slots_mod, "_available_bytes", lambda *args: 64 * 1024**3)
    functions = (
        "init_db",
        "init_queue",
        "init_pubsub",
        "init_ops_client",
        "subscribe_dek_invalidations",
        "close_dek_invalidation_subscriber",
        "close_ops_client",
        "close_queue",
        "close_pubsub",
        "close_db",
    )
    patched = {}
    for name in functions:
        mock = AsyncMock()
        monkeypatch.setattr(lifecycle, name, mock)
        patched[name] = mock
    storage = AsyncMock()
    storage_factory = MagicMock(return_value=storage)
    monkeypatch.setattr(lifecycle, "S3Storage", storage_factory)
    search_engine = MagicMock()
    search_engine.startup = AsyncMock()
    search_engine.shutdown = AsyncMock()
    search_engine_factory = MagicMock(return_value=search_engine)
    monkeypatch.setattr(lifecycle, "MeiliSearchEngine", search_engine_factory)
    patched["storage"] = storage
    patched["storage_factory"] = storage_factory
    patched["search_engine"] = search_engine
    patched["search_engine_factory"] = search_engine_factory
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
    adapter_builder = MagicMock(return_value={"test": adapter})
    monkeypatch.setattr(lifecycle, "build_delivery_adapters", adapter_builder)
    ctx = {}

    await lifecycle.core_on_startup(ctx)
    assert WORKER_READY.labels(queue=QueueName.CORE)._value.get() == 1
    await lifecycle.core_on_shutdown(ctx)

    assert ctx["queue"] is QueueName.CORE
    assert WORKER_READY.labels(queue=QueueName.CORE)._value.get() == 0
    resources["init_db"].assert_awaited_once_with(
        skip_migrations=True,
        application_name="uniffy-worker-core",
    )
    resources["storage_factory"].assert_called_once_with()
    resources["storage"].startup.assert_awaited_once_with()
    resources["storage"].shutdown.assert_awaited_once_with()
    resources["search_engine_factory"].assert_called_once_with()
    resources["search_engine"].startup.assert_awaited_once()
    resources["search_engine"].shutdown.assert_awaited_once_with()
    assert WORKSPACE_SEARCH_CTX_KEY not in ctx
    assert SEARCH_INDEXER_CTX_KEY not in ctx
    assert SESSION_FACTORY_CTX_KEY not in ctx
    assert DELIVERY_ADAPTERS_CTX_KEY not in ctx
    register_realtime.assert_called_once()
    resources["init_queue"].assert_awaited_once_with(QueueName.CORE)
    load_vapid.assert_awaited_once_with()
    provision.assert_awaited_once_with(ctx)
    adapter_builder.assert_called_once_with(lifecycle.open_session)
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
    resources["init_db"].assert_awaited_once_with(
        skip_migrations=True,
        application_name="uniffy-worker-egress",
    )
    resources["init_queue"].assert_awaited_once_with(QueueName.EGRESS)
    provider_start.assert_awaited_once_with()
    integration_start.assert_awaited_once_with()
    provider_close.assert_awaited_once_with()
    integration_close.assert_awaited_once_with()
    resources["close_queue"].assert_awaited_once_with(QueueName.EGRESS)


async def test_media_lifecycle_owns_its_queue_without_delivery_or_provider_subscribers(monkeypatch):
    resources = _patch_shared_resources(monkeypatch)
    delivery = MagicMock()
    providers = AsyncMock()
    monkeypatch.setattr(lifecycle, "build_delivery_adapters", delivery)
    monkeypatch.setattr(lifecycle, "init_provider_invalidation_subscriber", providers)
    ctx = {}

    await lifecycle.media_on_startup(ctx)
    assert WORKER_READY.labels(queue=QueueName.MEDIA)._value.get() == 1
    await lifecycle.media_on_shutdown(ctx)

    assert WORKER_READY.labels(queue=QueueName.MEDIA)._value.get() == 0
    resources["init_db"].assert_awaited_once_with(
        skip_migrations=True, application_name="uniffy-worker-media"
    )
    resources["init_queue"].assert_awaited_once_with(QueueName.MEDIA)
    resources["close_queue"].assert_awaited_once_with(QueueName.MEDIA)
    resources["storage"].shutdown.assert_awaited_once_with()
    delivery.assert_not_called()
    providers.assert_not_awaited()


async def test_media_workers_start_with_independent_encode_capacity(monkeypatch) -> None:
    _patch_shared_resources(monkeypatch)
    monkeypatch.setattr(
        lifecycle, "MEDIA_SETTINGS", replace(lifecycle.MEDIA_SETTINGS, max_concurrent=2)
    )
    first, second = {}, {}
    await lifecycle.media_on_startup(first)
    await lifecycle.media_on_startup(second)
    try:
        async with AsyncExitStack() as held:
            for ctx in (first, second):
                slots = ctx[MEDIA_SLOTS_CTX_KEY]
                for _ in range(2):
                    assert await held.enter_async_context(slots.acquire())
                async with slots.acquire() as acquired:
                    assert not acquired
    finally:
        await lifecycle.media_on_shutdown(first)
        await lifecycle.media_on_shutdown(second)
    assert MEDIA_SLOTS_CTX_KEY not in first
    assert MEDIA_SLOTS_CTX_KEY not in second
    await lifecycle.media_on_startup(first)
    try:
        async with first[MEDIA_SLOTS_CTX_KEY].acquire() as acquired:
            assert acquired
    finally:
        await lifecycle.media_on_shutdown(first)


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
