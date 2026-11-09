"""Egress handlers for provider sign-in and remote disconnect cleanup."""

import asyncio
from datetime import datetime
from typing import Any
from uuid import UUID

from loguru import logger

from uniffy.core.crypto.org_cipher import OrgCipher
from uniffy.core.errors import MembershipRequiredError, PermissionDeniedError, ValidationError
from uniffy.core.jobs import enqueue_job_reconnecting
from uniffy.core.json_codec import loads
from uniffy.core.models.calendar.connection import CalendarConnection
from uniffy.domains.scheduling.calendar.connections.cleanup import CleanupStatus, run_cleanup
from uniffy.domains.scheduling.calendar.connections.oauth import (
    CompletionFailure,
    exchange_connection,
)
from uniffy.domains.scheduling.calendar.jobs.contracts import (
    CLEANUP_JOB_TIMEOUT_SECONDS,
    CONNECT_JOB_TIMEOUT_SECONDS,
    DISCOVER_CONNECTION_CALENDARS,
)
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="scheduling.calendar.jobs.lifecycle")
_DISCOVERY_WAKE_TIMEOUT_SECONDS = 2


async def complete_calendar_connection(
    ctx: dict[str, Any], user_id: str, organization_id: str, sealed: str
) -> dict[str, Any]:
    try:
        async with asyncio.timeout(CONNECT_JOB_TIMEOUT_SECONDS), open_session() as session:
            org_id = UUID(organization_id)
            payload = loads(await OrgCipher(session).decrypt(org_id, sealed))
            await session.rollback()
            completed = await exchange_connection(
                session,
                UUID(user_id),
                org_id,
                code=payload["code"],
                state=payload["state"],
                error=payload["error"],
                error_description=payload["error_description"],
                deadline=datetime.fromisoformat(payload["deadline"]),
            )
            connection = await session.get(CalendarConnection, completed.connection_id)
            generation = connection.generation if connection is not None else None
    except MembershipRequiredError:
        return {"failure": CompletionFailure.MEMBERSHIP.value}
    except PermissionDeniedError:
        return {"failure": CompletionFailure.DENIED.value}
    except ValidationError as exc:
        return {
            "failure": CompletionFailure.INVALID.value,
            "field": exc.field,
            "message": exc.message,
        }
    except Exception as exc:
        # Neither exception text nor local-variable tracebacks may reveal OAuth credentials.
        logger.error("Calendar sign-in job failed", error_type=type(exc).__name__)
        return {"failure": CompletionFailure.UNAVAILABLE.value}
    if generation is not None:
        try:
            async with asyncio.timeout(_DISCOVERY_WAKE_TIMEOUT_SECONDS):
                await enqueue_job_reconnecting(
                    DISCOVER_CONNECTION_CALENDARS,
                    str(completed.connection_id),
                    generation,
                )
        except Exception:
            # next_discovery_at already committed; the dispatcher recovers the wake.
            logger.warning("Connected calendar discovery wake deferred")
    return {
        "connection_id": str(completed.connection_id),
        "return_path": completed.return_path,
        "reconnected": completed.reconnected,
    }


async def cleanup_calendar_connection(
    ctx: dict[str, Any], connection_id: str, organization_id: str, generation: int, sealed: str
) -> dict[str, str]:
    try:
        async with asyncio.timeout(CLEANUP_JOB_TIMEOUT_SECONDS), open_session() as session:
            status = await run_cleanup(
                session,
                UUID(connection_id),
                UUID(organization_id),
                generation,
                sealed,
            )
    except Exception as exc:
        logger.error("Calendar cleanup job failed", error_type=type(exc).__name__)
        status = CleanupStatus.FAILED
    return {"status": status.value}
