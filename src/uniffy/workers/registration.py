"""Convert validated job records into ARQ worker definitions."""

import inspect
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from uniffy.core.jobs import JobRef, JobWorkload
from uniffy.core.valkey.queue import QueueName
from uniffy.vendor.arq.cron import CronJob, cron
from uniffy.vendor.arq.worker import Function, func

type JobHandler = Callable[..., Awaitable[Any]]
type Seconds = int | float | timedelta
type CronOption = int | tuple[int, ...] | None
type CronWeekday = CronOption | str

_WORKLOAD_QUEUES = {
    JobWorkload.CONTROL: QueueName.CORE,
    JobWorkload.DELIVERY: QueueName.CORE,
    JobWorkload.MEDIA: QueueName.CORE,
    JobWorkload.AGENT: QueueName.EGRESS,
    JobWorkload.INTEGRATION: QueueName.EGRESS,
}


@dataclass(frozen=True, slots=True)
class JobRegistration:
    ref: JobRef
    handler: JobHandler
    timeout: Seconds | None = None
    keep_result: Seconds | None = None
    keep_result_forever: bool | None = None
    max_tries: int | None = None

    def to_arq(self) -> Function:
        return func(
            self.handler,
            name=self.ref.name,
            timeout=self.timeout,
            keep_result=self.keep_result,
            keep_result_forever=self.keep_result_forever,
            max_tries=self.max_tries,
        )


@dataclass(frozen=True, slots=True)
class ScheduledJobRegistration:
    ref: JobRef
    handler: JobHandler
    month: CronOption = None
    day: CronOption = None
    weekday: CronWeekday = None
    hour: CronOption = None
    minute: CronOption = None
    second: CronOption = 0
    microsecond: int = 123_456
    run_at_startup: bool = False
    unique: bool = True
    job_id: str | None = None
    timeout: Seconds | None = None
    keep_result: Seconds | None = 0
    keep_result_forever: bool | None = False
    max_tries: int | None = 1

    def to_arq(self) -> CronJob:
        return cron(
            self.handler,
            name=self.ref.name,
            month=_cron_option(self.month),
            day=_cron_option(self.day),
            weekday=_cron_weekday(self.weekday),
            hour=_cron_option(self.hour),
            minute=_cron_option(self.minute),
            second=_cron_option(self.second),
            microsecond=self.microsecond,
            run_at_startup=self.run_at_startup,
            unique=self.unique,
            job_id=self.job_id,
            timeout=self.timeout,
            keep_result=self.keep_result,
            keep_result_forever=self.keep_result_forever,
            max_tries=self.max_tries,
        )


@dataclass(frozen=True, slots=True)
class WorkerDefinitions:
    functions: tuple[Function, ...]
    cron_jobs: tuple[CronJob, ...]


def queue_for_workload(workload: JobWorkload) -> QueueName:
    return _WORKLOAD_QUEUES[workload]


def _cron_option(value: CronOption) -> int | set[int] | None:
    return set(value) if isinstance(value, tuple) else value


def _cron_weekday(value: CronWeekday) -> int | set[int] | str | None:
    return _cron_option(value) if not isinstance(value, str) else value


def build_worker_definitions(
    queue: QueueName,
    registrations: Sequence[JobRegistration],
    schedules: Sequence[ScheduledJobRegistration] = (),
) -> WorkerDefinitions:
    names: set[str] = set()
    for registration in (*registrations, *schedules):
        if registration.ref.name in names:
            raise ValueError(f"Duplicate job registration: {registration.ref.name}")
        names.add(registration.ref.name)
        if registration.ref.queue is not queue:
            raise ValueError(
                f"Job {registration.ref.name} targets {registration.ref.queue}, not fleet {queue}"
            )
        expected_queue = queue_for_workload(registration.ref.workload)
        if registration.ref.queue is not expected_queue:
            raise ValueError(
                f"Job {registration.ref.name} workload {registration.ref.workload} "
                f"must run on {expected_queue}"
            )
        if not inspect.iscoroutinefunction(registration.handler):
            raise TypeError(f"Job handler must be async: {registration.ref.name}")

    return WorkerDefinitions(
        functions=tuple(registration.to_arq() for registration in registrations),
        cron_jobs=tuple(schedule.to_arq() for schedule in schedules),
    )


def _refs_by_name(kind: str, refs: Sequence[JobRef]) -> dict[str, JobRef]:
    indexed: dict[str, JobRef] = {}
    for ref in refs:
        if ref.name in indexed:
            raise ValueError(f"Duplicate {kind} job ref: {ref.name}")
        indexed[ref.name] = ref
    return indexed


def _validate_catalog(
    kind: str,
    registered_refs: Sequence[JobRef],
    catalog_refs: Sequence[JobRef],
) -> None:
    registered = _refs_by_name(f"registered {kind}", registered_refs)
    catalog = _refs_by_name(f"catalogued {kind}", catalog_refs)
    if registered.keys() != catalog.keys():
        missing = sorted(registered.keys() - catalog.keys())
        stale = sorted(catalog.keys() - registered.keys())
        raise ValueError(f"{kind} job catalog drift: missing={missing}, stale={stale}")

    mismatched = sorted(name for name in registered if registered[name] != catalog[name])
    if mismatched:
        raise ValueError(f"{kind} job ref metadata drift: {mismatched}")


def validate_job_catalogs(
    registrations: Sequence[JobRegistration],
    schedules: Sequence[ScheduledJobRegistration],
    enqueueable_refs: Sequence[JobRef],
    scheduled_refs: Sequence[JobRef],
) -> None:
    registered_jobs = tuple(registration.ref for registration in registrations)
    registered_schedules = tuple(schedule.ref for schedule in schedules)
    _refs_by_name("registered", (*registered_jobs, *registered_schedules))
    _refs_by_name("catalogued", (*enqueueable_refs, *scheduled_refs))
    _validate_catalog("enqueueable", registered_jobs, enqueueable_refs)
    _validate_catalog("scheduled", registered_schedules, scheduled_refs)


__all__ = [
    "JobHandler",
    "JobRegistration",
    "ScheduledJobRegistration",
    "WorkerDefinitions",
    "build_worker_definitions",
    "queue_for_workload",
    "validate_job_catalogs",
]
