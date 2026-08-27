from collections.abc import Sequence
from datetime import timedelta
from enum import StrEnum
from typing import TYPE_CHECKING, Any, Literal, Optional, Protocol, Union

__all__ = (
    'OptionType',
    'WeekdayOptionType',
    'WEEKDAYS',
    'SecondsTimedelta',
    'WorkerCoroutine',
    'StartupShutdown',
    'HealthCheck',
    'JobRejected',
    'JobRejectionReason',
    'WorkerSettingsType',
)


if TYPE_CHECKING:
    from .cron import CronJob
    from .worker import Function

OptionType = Union[None, set[int], int]
WEEKDAYS = 'mon', 'tues', 'wed', 'thurs', 'fri', 'sat', 'sun'
WeekdayOptionType = Union[OptionType, Literal['mon', 'tues', 'wed', 'thurs', 'fri', 'sat', 'sun']]
SecondsTimedelta = Union[int, float, timedelta]


class JobRejectionReason(StrEnum):
    EXPIRED = 'expired'
    DESERIALIZATION_FAILED = 'deserialization_failed'
    ABORTED_BEFORE_START = 'aborted_before_start'
    FUNCTION_NOT_FOUND = 'function_not_found'
    MAX_RETRIES_EXCEEDED = 'max_retries_exceeded'


class WorkerCoroutine(Protocol):
    __qualname__: str

    async def __call__(self, ctx: dict[Any, Any], *args: Any, **kwargs: Any) -> Any:  # pragma: no cover
        pass


class StartupShutdown(Protocol):
    __qualname__: str

    async def __call__(self, ctx: dict[Any, Any]) -> Any:  # pragma: no cover
        pass


class HealthCheck(Protocol):
    __qualname__: str

    async def __call__(
        self,
        ctx: dict[Any, Any],
        *,
        queue_depth: int,
        heartbeat_timestamp: float,
    ) -> Any:  # pragma: no cover
        pass


class JobRejected(Protocol):
    __qualname__: str

    async def __call__(
        self,
        ctx: dict[Any, Any],
        *,
        reason: JobRejectionReason,
    ) -> Any:  # pragma: no cover
        pass


class WorkerSettingsBase(Protocol):
    functions: Sequence[Union[WorkerCoroutine, 'Function']]
    cron_jobs: Optional[Sequence['CronJob']] = None
    on_startup: Optional[StartupShutdown] = None
    on_shutdown: Optional[StartupShutdown] = None
    on_health_check: Optional[HealthCheck] = None
    on_job_rejected: Optional[JobRejected] = None
    # and many more...


WorkerSettingsType = Union[dict[str, Any], type[WorkerSettingsBase]]
