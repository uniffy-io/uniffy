"""Render the worker architecture from the executable registry."""

from dataclasses import dataclass
from datetime import timedelta

from uniffy.core.jobs import JobRef
from uniffy.core.valkey.queue import QueueName
from uniffy.workers.fleets.core import CoreWorkerSettings
from uniffy.workers.fleets.egress import EgressWorkerSettings
from uniffy.workers.registration import JobRegistration, ScheduledJobRegistration, Seconds
from uniffy.workers.registry import (
    CORE_JOB_REGISTRATIONS,
    CORE_SCHEDULED_REGISTRATIONS,
    EGRESS_JOB_REGISTRATIONS,
    EGRESS_SCHEDULED_REGISTRATIONS,
)

_JOBS_PACKAGE = "jobs"


@dataclass(frozen=True, slots=True)
class JobInventoryEntry:
    ref: JobRef
    owner: str
    trigger: str
    timeout_seconds: float
    max_tries: int


def _seconds(value: Seconds | None, default: int) -> float:
    if value is None:
        return float(default)
    if isinstance(value, timedelta):
        return value.total_seconds()
    return float(value)


def _owner(registration: JobRegistration | ScheduledJobRegistration) -> str:
    parts = registration.handler.__module__.split(".")
    try:
        start = parts.index("domains") + 1
    except ValueError:
        try:
            start = parts.index("core") + 1
        except ValueError:
            return registration.handler.__module__
    stop = parts.index(_JOBS_PACKAGE, start) if _JOBS_PACKAGE in parts[start:] else start + 1
    return ".".join(parts[start:stop])


def _cron_value(value: object) -> str:
    if isinstance(value, tuple):
        return ",".join(str(item) for item in value)
    return str(value)


def _trigger(registration: JobRegistration | ScheduledJobRegistration) -> str:
    if isinstance(registration, JobRegistration):
        return "enqueue"
    fields = (
        ("month", registration.month),
        ("day", registration.day),
        ("weekday", registration.weekday),
        ("hour", registration.hour),
        ("minute", "*" if registration.minute is None else registration.minute),
        ("second", registration.second),
    )
    return "cron " + " ".join(
        f"{name}={_cron_value(value)}" for name, value in fields if value is not None
    )


def _fleet_defaults(queue: QueueName) -> tuple[int, int]:
    settings = CoreWorkerSettings if queue is QueueName.CORE else EgressWorkerSettings
    return settings.job_timeout, settings.max_tries


def _entry(
    registration: JobRegistration | ScheduledJobRegistration,
) -> JobInventoryEntry:
    timeout, retries = _fleet_defaults(registration.ref.queue)
    return JobInventoryEntry(
        ref=registration.ref,
        owner=_owner(registration),
        trigger=_trigger(registration),
        timeout_seconds=_seconds(registration.timeout, timeout),
        max_tries=registration.max_tries if registration.max_tries is not None else retries,
    )


def worker_inventory() -> tuple[JobInventoryEntry, ...]:
    registrations = (
        *CORE_JOB_REGISTRATIONS,
        *CORE_SCHEDULED_REGISTRATIONS,
        *EGRESS_JOB_REGISTRATIONS,
        *EGRESS_SCHEDULED_REGISTRATIONS,
    )
    return tuple(_entry(registration) for registration in registrations)


def _cell(value: object) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ")


def render_worker_inventory() -> str:
    lines = ["Worker resources"]
    for settings in (CoreWorkerSettings, EgressWorkerSettings):
        resources = ", ".join(resource.value for resource in settings.resource_profile.resources)
        lines.append(f"- {settings.resource_profile.queue.value}: {resources}")

    headers = (
        "name",
        "owner",
        "workload",
        "reliability",
        "queue",
        "trigger",
        "timeout",
        "retries",
        "PostgreSQL fact",
        "recovery trigger",
    )
    lines.extend(("", "Worker jobs", "", f"| {' | '.join(headers)} |"))
    lines.append(f"| {' | '.join('---' for _ in headers)} |")
    for entry in worker_inventory():
        recovery = entry.ref.recovery
        values = (
            entry.ref.name,
            entry.owner,
            entry.ref.workload.value,
            entry.ref.reliability.value,
            entry.ref.queue.valkey_name,
            entry.trigger,
            f"{entry.timeout_seconds:g}s",
            entry.max_tries,
            recovery.fact if recovery else "-",
            recovery.trigger if recovery else "-",
        )
        lines.append(f"| {' | '.join(_cell(value) for value in values)} |")
    return "\n".join(lines)


def main() -> None:
    print(render_worker_inventory())


if __name__ == "__main__":
    main()
