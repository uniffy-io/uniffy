import inspect

import pytest

from uniffy.core.jobs import JobRef, JobReliability, JobWorkload
from uniffy.core.valkey.queue import QueueName
from uniffy.vendor.arq.worker import create_worker
from uniffy.workers.fleets import CoreWorkerSettings, EgressWorkerSettings
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


def test_catalog_validation_rejects_an_unbound_scheduled_ref() -> None:
    with pytest.raises(ValueError):
        validate_job_catalogs((), (), (), (_ref(),))


@pytest.mark.parametrize("settings_cls", (CoreWorkerSettings, EgressWorkerSettings))
def test_production_fleet_constructs_with_real_registry(settings_cls: type) -> None:
    worker = create_worker(settings_cls, handle_signals=False)

    assert worker.queue_name == settings_cls.queue_name
    assert worker.functions
    assert all(
        inspect.iscoroutinefunction(definition.coroutine) for definition in worker.functions.values()
    )
