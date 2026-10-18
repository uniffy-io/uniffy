"""Refresh the search access events inherit from their calendar."""

from collections import defaultdict
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import delete, select, update

from uniffy.core.jobs.locks import acquire_owned_job_lock, release_owned_job_lock
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.search_acl_refresh import CalendarSearchAclRefresh
from uniffy.core.search import SearchIndexer
from uniffy.core.search.workspace import WORKSPACE_SEARCH_CTX_KEY, WorkspaceSearch
from uniffy.domains.scheduling.calendar.calendars.reader import CalendarReader
from uniffy.domains.scheduling.calendar.calendars.search import (
    calendar_event_ids,
    calendar_search_access,
    event_document_ids,
    record_calendar_search_acl_refresh,
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


async def _patch_batch(
    calendar_id: UUID,
    organization_id: UUID,
    event_ids: list[UUID],
    search: WorkspaceSearch,
) -> int:
    async with open_session() as session:
        rows = (
            await session.execute(
                select(CalendarEvent.id, CalendarEvent.calendar_id).where(
                    CalendarEvent.organization_id == organization_id,
                    CalendarEvent.id.in_(event_ids),
                    CalendarEvent.is_deleted.is_(False),
                )
            )
        ).all()
        locations = {row.id: row.calendar_id for row in rows}
        groups: dict[UUID, list[UUID]] = defaultdict(list)
        for event_id, current_calendar_id in locations.items():
            groups[current_calendar_id].append(event_id)
        audiences = {
            current_id: await calendar_search_access(session, organization_id, current_id)
            for current_id in groups
        }

    updated = 0
    for current_id, ids in groups.items():
        updated += await search.update_container_access(
            event_document_ids(organization_id, ids), audiences[current_id]
        )

    async with open_session() as session:
        current_rows = (
            await session.execute(
                select(CalendarEvent.id, CalendarEvent.calendar_id).where(
                    CalendarEvent.organization_id == organization_id,
                    CalendarEvent.id.in_(event_ids),
                    CalendarEvent.is_deleted.is_(False),
                )
            )
        ).all()
        destinations = {
            row.calendar_id for row in current_rows if locations.get(row.id) != row.calendar_id
        }
        for destination in sorted(destinations):
            await record_calendar_search_acl_refresh(session, organization_id, destination)
        # Keep the checkpoint until any relocation repair is durable. A crash
        # after a search write replays these same ids using their current calendars.
        await session.execute(
            update(CalendarSearchAclRefresh)
            .where(
                CalendarSearchAclRefresh.calendar_id == calendar_id,
            )
            .values(pending_event_ids=[])
        )
        await session.commit()
    return updated


async def _process_calendar(calendar_id: UUID, search: WorkspaceSearch) -> dict[str, Any]:
    async with open_session() as session:
        row = await session.get(CalendarSearchAclRefresh, calendar_id)
        if row is None:
            return {"status": "empty"}
        version, organization_id = row.version, row.organization_id
        pending = list(row.pending_event_ids)

    updated = 0
    after: UUID | None = None
    try:
        async with open_session() as session:
            calendar = await session.get(Calendar, calendar_id)
            if calendar is not None and not calendar.is_deleted:
                await CalendarReader(
                    session, _search_indexer=SearchIndexer(search)
                )._index_for_search(calendar)
        if pending:
            updated += await _patch_batch(calendar_id, organization_id, pending, search)
        while True:
            async with open_session() as session:
                event_ids = list(
                    (
                        await session.execute(
                            calendar_event_ids(
                                organization_id,
                                calendar_id,
                                after=after,
                                limit=_EVENT_BATCH,
                            )
                        )
                    ).scalars()
                )
                if event_ids:
                    await session.execute(
                        update(CalendarSearchAclRefresh)
                        .where(
                            CalendarSearchAclRefresh.calendar_id == calendar_id,
                        )
                        .values(pending_event_ids=event_ids)
                    )
                    await session.commit()
            if not event_ids:
                break
            updated += await _patch_batch(calendar_id, organization_id, event_ids, search)
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
