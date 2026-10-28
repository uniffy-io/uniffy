"""Call context and bounded outcomes shared by request and maintenance paths."""

import asyncio
import inspect
from collections.abc import Awaitable, Callable
from contextlib import suppress
from functools import wraps
from typing import Any
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from loguru import logger

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.calls import Call
from uniffy.domains.calls.config import LiveKitConfigError
from uniffy.domains.calls.livekit import LiveKitApiError
from uniffy.domains.calls.metrics import (
    JOINS,
    MAINTENANCE_LAST_SUCCESS,
    MAINTENANCE_REPAIRS,
    MAINTENANCE_RUNS,
    JoinOutcome,
    Outcome,
)

logger = logger.bind(component="calls.telemetry")

_VALIDATION_OUTCOMES = {
    "Call has ended": JoinOutcome.ENDED,
    "Call is full": JoinOutcome.FULL,
    "Already in this call on too many devices": JoinOutcome.DEVICE_LIMIT,
    "Already in a call in another channel": JoinOutcome.ANOTHER_CALL,
}


def join_outcome(exc: BaseException) -> JoinOutcome:
    if isinstance(exc, ConnectError):
        if exc.__cause__ is not None:
            cause = join_outcome(exc.__cause__)
            if cause != JoinOutcome.ERROR:
                return cause
        if exc.code == Code.INVALID_ARGUMENT:
            return JoinOutcome.INVALID
    if isinstance(exc, asyncio.CancelledError):
        return JoinOutcome.CANCELLED
    if isinstance(exc, NotFoundError):
        return JoinOutcome.NOT_FOUND
    if isinstance(exc, PermissionDeniedError):
        return (
            JoinOutcome.DISABLED
            if exc.resource == "Calls are disabled for this organization"  # noqa: PLR2004
            else JoinOutcome.DENIED
        )
    if isinstance(exc, ValidationError):
        return _VALIDATION_OUTCOMES.get(exc.message, JoinOutcome.INVALID)
    if isinstance(exc, LiveKitConfigError):
        return JoinOutcome.NOT_CONFIGURED
    if isinstance(exc, LiveKitApiError):
        return JoinOutcome.MEDIA_UNAVAILABLE
    return JoinOutcome.ERROR


def observe_join[**P, R](function: Callable[P, Awaitable[R]]) -> Callable[P, Awaitable[R]]:
    @wraps(function)
    async def observed(*args: P.args, **kwargs: P.kwargs) -> R:
        outcome = JoinOutcome.SUCCESS
        result = None
        try:
            result = await function(*args, **kwargs)
            return result
        except BaseException as exc:
            outcome = join_outcome(exc)
            raise
        finally:
            JOINS.labels(function.__name__, outcome).inc()
            fields = {}
            call_id = getattr(getattr(result, "call", None), "id", None)
            if call_id:
                fields["call_id"] = str(call_id)
            logger.bind(operation=function.__name__, outcome=outcome, **fields).info(
                "Call admission result"
            )

    return observed


def call_context[**P, R](function: Callable[P, Awaitable[R]]) -> Callable[P, Awaitable[R]]:
    signature = inspect.signature(function)

    @wraps(function)
    async def contextualized(*args: P.args, **kwargs: P.kwargs) -> R:
        arguments = signature.bind(*args, **kwargs).arguments
        call = arguments.get("call")
        request = arguments.get("request")
        fields: dict[str, str] = {}
        for field in ("call_id", "organization_id"):
            value = arguments.get(field) or getattr(request, field, None)
            if isinstance(call, Call):
                value = call.id if field == "call_id" else call.organization_id  # noqa: PLR2004
            if value:
                with suppress(ValueError):
                    fields[field] = str(UUID(str(value)))
        with logger.contextualize(**fields):
            try:
                return await function(*args, **kwargs)
            except Exception as exc:
                if fields.get("call_id"):
                    logger.bind(operation=function.__name__, error_type=type(exc).__name__).warning(
                        "Call operation failed"
                    )
                raise

    return contextualized


def observe_maintenance(
    function: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]],
) -> Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]:
    @wraps(function)
    async def observed(ctx: dict[str, Any]) -> dict[str, Any]:
        outcome = Outcome.ERROR
        try:
            result = await function(ctx)
            outcome = Outcome(result["status"])
            if outcome == Outcome.SUCCESS and result.get("media_reachable") is False:
                outcome = Outcome.DEGRADED
            if outcome == Outcome.SUCCESS:
                MAINTENANCE_LAST_SUCCESS.labels(function.__name__).set_to_current_time()
            for repair in (
                "ended",
                "ghost_participants",
                "revoked_participants",
                "closed_rooms",
                "closed",
            ):
                if repair in result:
                    MAINTENANCE_REPAIRS.labels(function.__name__, repair).inc(result[repair])
            return result
        except asyncio.CancelledError:
            outcome = Outcome.CANCELLED
            raise
        finally:
            MAINTENANCE_RUNS.labels(function.__name__, outcome).inc()
            logger.bind(job=function.__name__, outcome=outcome).info("Call maintenance result")

    return observed
