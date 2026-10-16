import inspect

import pytest

from uniffy.core.jobs import (
    JobRecovery,
    JobRef,
    JobReliability,
    JobWorkload,
    QueueName,
    RecoveryStore,
)
from uniffy.vendor.arq.worker import create_worker
from uniffy.workers.fleets import CoreWorkerSettings, EgressWorkerSettings, MediaWorkerSettings
from uniffy.domains.files.jobs.contracts import FILE_JOB_REFS
from uniffy.workers.inventory import worker_inventory
from uniffy.workers.registration import (
    JobRegistration,
    build_worker_definitions,
    validate_job_catalogs,
)


async def _handler(ctx: dict[str, object]) -> None:
    del ctx


def _sync_handler(ctx: dict[str, object]) -> None:
    del ctx


def _ref(*, queue: QueueName = QueueName.CORE) -> JobRef:
    return JobRef(
        name="example_job",
        queue=queue,
        workload=JobWorkload.CONTROL,
        reliability=JobReliability.BEST_EFFORT,
    )


def test_build_worker_definitions_binds_the_ref_to_the_handler() -> None:
    ref = _ref()
    definitions = build_worker_definitions(
        QueueName.CORE,
        (JobRegistration(ref=ref, handler=_handler),),
    )

    (function,) = definitions.functions
    assert function.name == ref.name
    assert function.coroutine is _handler


def test_build_worker_definitions_rejects_duplicate_refs() -> None:
    registration = JobRegistration(ref=_ref(), handler=_handler)

    with pytest.raises(ValueError):
        build_worker_definitions(QueueName.CORE, (registration, registration))


def test_build_worker_definitions_rejects_the_wrong_fleet() -> None:
    registration = JobRegistration(ref=_ref(queue=QueueName.EGRESS), handler=_handler)

    with pytest.raises(ValueError):
        build_worker_definitions(QueueName.CORE, (registration,))


def test_build_worker_definitions_rejects_synchronous_handlers() -> None:
    registration = JobRegistration(ref=_ref(), handler=_sync_handler)

    with pytest.raises(TypeError):
        build_worker_definitions(QueueName.CORE, (registration,))


def test_durable_job_requires_an_authoritative_recovery_path() -> None:
    with pytest.raises(ValueError):
        JobRef(
            name="durable_job",
            queue=QueueName.CORE,
            workload=JobWorkload.CONTROL,
            reliability=JobReliability.DURABLE,
        )


def _recovery(store: RecoveryStore) -> JobRecovery:
    return JobRecovery(fact="pending fact", trigger="sweep schedule", store=store)


@pytest.mark.parametrize(
    ("reliability", "recovery"),
    [
        (JobReliability.BUFFERED, None),
        (JobReliability.BUFFERED, _recovery(RecoveryStore.POSTGRESQL)),
        (JobReliability.DURABLE, _recovery(RecoveryStore.VALKEY)),
    ],
)
def test_reliability_requires_a_recovery_fact_in_its_own_store(
    reliability: JobReliability, recovery: JobRecovery | None
) -> None:
    with pytest.raises(ValueError):
        JobRef(
            name="example_job",
            queue=QueueName.CORE,
            workload=JobWorkload.CONTROL,
            reliability=reliability,
            recovery=recovery,
        )


@pytest.mark.parametrize(("fact", "trigger"), [("", "sweep schedule"), ("pending fact", " ")])
def test_buffered_recovery_needs_a_named_fact_and_sweep(fact: str, trigger: str) -> None:
    with pytest.raises(ValueError):
        JobRecovery(fact=fact, trigger=trigger, store=RecoveryStore.VALKEY)


def test_buffered_job_with_a_valkey_recovery_is_accepted() -> None:
    ref = JobRef(
        name="example_job",
        queue=QueueName.CORE,
        workload=JobWorkload.CONTROL,
        reliability=JobReliability.BUFFERED,
        recovery=_recovery(RecoveryStore.VALKEY),
    )

    assert ref.recovery is not None
    assert ref.recovery.store is RecoveryStore.VALKEY


def test_inventory_shows_each_reliability_with_the_store_its_recovery_reads() -> None:
    stores: dict[JobReliability, set[RecoveryStore]] = {}
    for entry in worker_inventory():
        if entry.ref.recovery is not None:
            stores.setdefault(entry.ref.reliability, set()).add(entry.ref.recovery.store)

    assert stores[JobReliability.BUFFERED] == {RecoveryStore.VALKEY}
    assert stores[JobReliability.DURABLE] == {RecoveryStore.POSTGRESQL}


def test_catalog_validation_rejects_an_unbound_scheduled_ref() -> None:
    with pytest.raises(ValueError):
        validate_job_catalogs((), (), (), (_ref(),))


@pytest.mark.parametrize(
    "settings_cls", (CoreWorkerSettings, EgressWorkerSettings, MediaWorkerSettings)
)
def test_production_fleet_constructs_with_real_registry(settings_cls: type) -> None:
    worker = create_worker(settings_cls, handle_signals=False)

    assert worker.queue_name == settings_cls.queue_name
    assert worker.functions
    assert all(
        inspect.iscoroutinefunction(definition.coroutine) for definition in worker.functions.values()
    )


def test_media_jobs_are_consumed_only_by_media_workers() -> None:
    media = create_worker(MediaWorkerSettings, handle_signals=False)
    core = create_worker(CoreWorkerSettings, handle_signals=False)
    egress = create_worker(EgressWorkerSettings, handle_signals=False)
    for ref in FILE_JOB_REFS:
        if ref.workload is JobWorkload.MEDIA:
            assert ref.queue.valkey_name == media.queue_name
            assert ref.name in media.functions
            assert ref.name not in core.functions
            assert ref.name not in egress.functions


@pytest.mark.parametrize(
    "settings", [CoreWorkerSettings, EgressWorkerSettings, MediaWorkerSettings]
)
def test_every_fleet_reads_and_writes_jobs_through_the_json_codec(settings: type) -> None:
    from uniffy.core.jobs.codec import deserialize_job_payload, serialize_job_payload
    from uniffy.vendor.arq.worker import get_kwargs

    kwargs = get_kwargs(settings)

    assert kwargs["job_serializer"] is serialize_job_payload
    assert kwargs["job_deserializer"] is deserialize_job_payload
