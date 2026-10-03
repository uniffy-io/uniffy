"""Refresh the search access events inherit from their calendar."""

from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import delete, select, update

from uniffy.core.jobs.locks import acquire_owned_job_lock, release_owned_job_lock
from uniffy.core.models.calendar.search_acl_refresh import CalendarSearchAclRefresh
from uniffy.core.search.workspace import WORKSPACE_SEARCH_CTX_KEY, WorkspaceSearch
from uniffy.domains.scheduling.calendar.calendars.search import (
    calendar_event_ids,
    calendar_search_access,
    event_document_ids,
)
from uniffy.domains.scheduling.calendar.jobs.contracts import REFRESH_CALENDAR_SEARCH_ACL
from uniffy.infrastructure.database import open_session
from uniffy.infrastructure.valkey.ops import get_ops_client
from uniffy.vendor.arq import Retry

logger = logger.bind(component="scheduling.calendar.jobs.search")

_LOCK_TTL_SECONDS = 330
_FLUSH_BATCH = 100
_EVENT_BATCH = 500
_LOCKED_RETRY_SECONDS = 30
_ATTEMPTS_ALERT_THRESHOLD = 60


def _lock_key(calendar_id: UUID) -> str:
    return f"calendar_search_acl:{calendar_id}:lock"


async def _acquire_lock(calendar_id: UUID) -> str | None:
    client = get_ops_client()
    if client is None:
        return None
    try:
        return await acquire_owned_job_lock(client, _lock_key(calendar_id), _LOCK_TTL_SECONDS)
    except Exception:
        logger.warning(f"Calendar search ACL lock failed for calendar {calendar_id}")
        return None


async def _release_lock(calendar_id: UUID, token: str) -> None:
    client = get_ops_client()
    if client is None:
        return
    try:
        await release_owned_job_lock(client, _lock_key(calendar_id), token)
    except Exception:
        logger.warning(f"Calendar search ACL lock release failed for calendar {calendar_id}")


async def _record_failure(calendar_id: UUID, version: int) -> None:
    async with open_session() as session:
        await session.execute(
            update(CalendarSearchAclRefresh)
            .where(
                CalendarSearchAclRefresh.calendar_id == calendar_id,
                CalendarSearchAclRefresh.version == version,
            )
            .values(attempts=CalendarSearchAclRefresh.attempts + 1)
        )
        await session.commit()


async def _process_calendar(calendar_id: UUID, search: WorkspaceSearch) -> dict[str, Any]:
    # Each database read is its own short session: a large calendar makes many
    # waited search calls, and none of them may hold a transaction open.
    async with open_session() as session:
        row = await session.get(CalendarSearchAclRefresh, calendar_id)
        if row is None:
            return {"status": "empty"}
        version = row.version
        organization_id = row.organization_id
        # A deleted calendar grants nothing, so its moved-away or deleted events
        # are patched to empty rather than skipped.
        access = await calendar_search_access(session, organization_id, calendar_id)

    updated = 0
    after: UUID | None = None
    try:
        while True:
            async with open_session() as session:
                event_ids = list(
                    (
                        await session.execute(
                            calendar_event_ids(
                                organization_id, calendar_id, after=after, limit=_EVENT_BATCH
                            )
                        )
                    ).scalars()
                )
            if not event_ids:
                break
            updated += await search.update_container_access(
                event_document_ids(organization_id, event_ids), access
            )
            if len(event_ids) < _EVENT_BATCH:
                break
            after = event_ids[-1]
    except Exception:
        await _record_failure(calendar_id, version)
        raise

    async with open_session() as session:
        deleted = await session.execute(
            delete(CalendarSearchAclRefresh).where(
                CalendarSearchAclRefresh.calendar_id == calendar_id,
                CalendarSearchAclRefresh.version == version,
            )
        )
        await session.commit()
    if not deleted.rowcount:
        return {"status": "superseded", "updated": updated}
    return {"status": "complete", "updated": updated}


async def refresh_calendar_search_acl(ctx: dict[str, Any], calendar_id: str) -> dict[str, Any]:
    parsed_calendar_id = UUID(calendar_id)
    lock_token = await _acquire_lock(parsed_calendar_id)
    if lock_token is None:
        # Another run holds the calendar; it may finish on an older version, so
        # come back rather than leave the newer one to the next sweep.
        raise Retry(defer=_LOCKED_RETRY_SECONDS)
    try:
        return await _process_calendar(parsed_calendar_id, ctx[WORKSPACE_SEARCH_CTX_KEY])
    except Exception as exc:
        logger.opt(exception=True).warning(
            f"Calendar search ACL refresh failed for calendar {parsed_calendar_id}"
        )
        raise Retry(defer=max(10, ctx.get("job_try", 1) * 10)) from exc
    finally:
        await _release_lock(parsed_calendar_id, lock_token)


async def flush_calendar_search_acl_refreshes(ctx: dict[str, Any]) -> dict[str, Any]:
    async with open_session() as session:
        rows = (
            await session.execute(
                select(CalendarSearchAclRefresh.calendar_id, CalendarSearchAclRefresh.attempts)
                # Fresh rows first, so persistently failing ones cannot crowd out the batch.
                .order_by(CalendarSearchAclRefresh.attempts, CalendarSearchAclRefresh.created_at)
                .limit(_FLUSH_BATCH)
            )
        ).all()

    queue = ctx.get("valkey")
    if queue is None:
        return {"status": "skipped", "reason": "queue_unavailable"}

    enqueued = 0
    failed = 0
    stuck = sum(1 for _calendar_id, attempts in rows if attempts >= _ATTEMPTS_ALERT_THRESHOLD)
    for queued_calendar_id, _attempts in rows:
        try:
            await queue.enqueue_job(REFRESH_CALENDAR_SEARCH_ACL.name, str(queued_calendar_id))
            enqueued += 1
        except Exception:
            failed += 1

    if stuck:
        logger.error(f"Calendar search ACL refresh has {stuck} persistently failing rows")
    return {"status": "complete", "enqueued": enqueued, "failed": failed}
