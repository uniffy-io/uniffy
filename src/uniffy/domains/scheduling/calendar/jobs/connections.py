"""Lease due provider work on the core fleet; discover, sync and push on the egress fleet."""

import traceback
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from uniffy.core.jobs import JobEnqueueOutcome, JobRef, enqueue_job_reconnecting
from uniffy.core.jobs.locks import acquire_owned_job_lock, release_owned_job_lock
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.connection import (
    CalendarConnection,
    CalendarConnectionAttempt,
    ConnectedCalendar,
    ConnectedCalendarState,
)
from uniffy.core.models.calendar.provider_push import CalendarProviderPush, PushState
from uniffy.core.search import SEARCH_INDEXER_CTX_KEY
from uniffy.core.types import CalendarType
from uniffy.domains.scheduling.calendar.connections.discovery import run_discovery
from uniffy.domains.scheduling.calendar.connections.push import run_push
from uniffy.domains.scheduling.calendar.connections.push_state import IN_FLIGHT_LEASE, SUPERSEDED
from uniffy.domains.scheduling.calendar.connections.run import SyncStatus, run_sync
from uniffy.domains.scheduling.calendar.connections.state import (
    PAUSED_RECHECK,
    owned_by_live_member,
)
from uniffy.domains.scheduling.calendar.jobs.contracts import (
    DISCOVER_CONNECTION_CALENDARS,
    PUSH_CALENDAR_CHANGE,
    SYNC_CONNECTED_CALENDAR,
)
from uniffy.domains.scheduling.calendar.policy import (
    policy_admits_sync,
    provider_deployment,
    resolve_calendar_policy,
)
from uniffy.infrastructure.database import open_session
from uniffy.infrastructure.valkey.ops import get_ops_client

logger = logger.bind(component="scheduling.calendar.jobs.connections")

SYNC_JOB_TIMEOUT_SECONDS = 300
DISCOVERY_JOB_TIMEOUT_SECONDS = 120
PUSH_JOB_TIMEOUT_SECONDS = 120
_DISPATCH_BATCH = 200
_LEASE = timedelta(minutes=10)
# Finished outbox rows stay a while for support questions, then go.
_PUSH_RETENTION = timedelta(days=30)
_ATTEMPT_RETENTION = timedelta(days=1)
_FINISHED_PUSHES = (PushState.DONE, PushState.CONFLICT_RESOLVED, PushState.FAILED)
_QUEUED = frozenset({JobEnqueueOutcome.ENQUEUED, JobEnqueueOutcome.DEDUPLICATED})


async def _admitted(session: AsyncSession, rows: list[Any]) -> tuple[list[Any], list[Any]]:
    """Rows whose organization still lets their owner sync, and the rest."""
    decisions: dict[tuple[UUID, UUID], bool] = {}
    policies: dict[UUID, Any] = {}
    allowed: list[Any] = []
    refused: list[Any] = []
    for row in rows:
        key = (row.organization_id, row.owner_id)
        if key not in decisions:
            if row.organization_id not in policies:
                policies[row.organization_id] = await resolve_calendar_policy(
                    session, row.organization_id
                )
            decisions[key] = await policy_admits_sync(
                session, policies[row.organization_id], row.owner_id
            )
        (allowed if decisions[key] else refused).append(row)
    return allowed, refused


async def dispatch_calendar_connections(ctx: dict[str, Any]) -> dict[str, int]:
    if not provider_deployment().sync_enabled:
        return {"discoveries": 0, "syncs": 0, "pushes": 0}
    now = datetime.now(UTC)
    async with open_session() as session:
        discoveries = await _lease_discoveries(session, now)
        syncs = await _lease_syncs(session, now)
        await _recover_stranded_pushes(session, now)
        pushes = await _lease_pushes(session, now)
        await _prune_finished_pushes(session, now)
        await _prune_sign_in_attempts(session, now)
        await session.commit()
    stamp = now.isoformat()
    queued = 0
    for connection_id, generation in discoveries:
        queued += await _enqueue(
            DISCOVER_CONNECTION_CALENDARS,
            str(connection_id),
            generation,
            job_id=f"calendar-discovery:{connection_id}:{stamp}",
        )
    for calendar_id, generation in syncs:
        queued += await _enqueue(
            SYNC_CONNECTED_CALENDAR,
            str(calendar_id),
            generation,
            job_id=f"calendar-sync:{calendar_id}:{stamp}",
        )
    for push_id, generation in pushes:
        queued += await _enqueue(
            PUSH_CALENDAR_CHANGE, str(push_id), generation, job_id=f"calendar-push:{push_id}:{stamp}"
        )
    return {
        "discoveries": len(discoveries),
        "syncs": len(syncs),
        "pushes": len(pushes),
        "queued": queued,
    }


async def _prune_finished_pushes(session: AsyncSession, now: datetime) -> None:
    expired = (
        select(CalendarProviderPush.id)
        .where(
            CalendarProviderPush.state.in_(_FINISHED_PUSHES),
            CalendarProviderPush.updated_at < now - _PUSH_RETENTION,
        )
        .limit(_DISPATCH_BATCH * 5)
        .scalar_subquery()
    )
    await session.execute(delete(CalendarProviderPush).where(CalendarProviderPush.id.in_(expired)))


async def _prune_sign_in_attempts(session: AsyncSession, now: datetime) -> None:
    # Each one seals a PKCE verifier; once expired it can never be used again.
    await session.execute(
        delete(CalendarConnectionAttempt).where(
            CalendarConnectionAttempt.expires_at < now - _ATTEMPT_RETENTION
        )
    )


async def _lease_discoveries(session: AsyncSession, now: datetime) -> list[tuple[UUID, int]]:
    rows = (
        await session.execute(
            owned_by_live_member(
                select(
                    CalendarConnection.id,
                    CalendarConnection.generation,
                    CalendarConnection.organization_id,
                    CalendarConnection.owner_id,
                )
            )
            .where(CalendarConnection.next_discovery_at <= now)
            .order_by(CalendarConnection.next_discovery_at)
            .limit(_DISPATCH_BATCH)
            .with_for_update(of=CalendarConnection, skip_locked=True)
        )
    ).all()
    allowed, refused = await _admitted(session, list(rows))
    for ids, due in (
        ([row.id for row in allowed], now + _LEASE),
        ([row.id for row in refused], now + PAUSED_RECHECK),
    ):
        if ids:
            await session.execute(
                update(CalendarConnection)
                .where(CalendarConnection.id.in_(ids))
                .values(next_discovery_at=due)
            )
    return [(row.id, row.generation) for row in allowed]


async def _lease_syncs(session: AsyncSession, now: datetime) -> list[tuple[UUID, int]]:
    rows = (
        await session.execute(
            owned_by_live_member(
                select(
                    ConnectedCalendar.id,
                    CalendarConnection.generation,
                    CalendarConnection.organization_id,
                    CalendarConnection.owner_id,
                )
                .join(CalendarConnection, CalendarConnection.id == ConnectedCalendar.connection_id)
                .join(Calendar, Calendar.id == ConnectedCalendar.calendar_id)
            )
            .where(
                ConnectedCalendar.next_sync_at <= now,
                ConnectedCalendar.state == ConnectedCalendarState.ACTIVE,
                ConnectedCalendar.sync_enabled.is_(True),
                Calendar.is_deleted.is_(False),
                Calendar.calendar_type == CalendarType.CONNECTED,
            )
            .order_by(ConnectedCalendar.next_sync_at)
            .limit(_DISPATCH_BATCH)
            .with_for_update(of=ConnectedCalendar, skip_locked=True)
        )
    ).all()
    allowed, refused = await _admitted(session, list(rows))
    for ids, due in (
        ([row.id for row in allowed], now + _LEASE),
        ([row.id for row in refused], now + PAUSED_RECHECK),
    ):
        if ids:
            await session.execute(
                update(ConnectedCalendar)
                .where(ConnectedCalendar.id.in_(ids))
                .values(next_sync_at=due)
            )
    return [(row.id, row.generation) for row in allowed]


async def _recover_stranded_pushes(session: AsyncSession, now: datetime) -> None:
    """A push whose worker died mid-flight goes back in line, unless a newer one replaced it."""
    stranded = (CalendarProviderPush.state == PushState.IN_FLIGHT) & (
        CalendarProviderPush.updated_at < now - IN_FLIGHT_LEASE
    )
    queued = aliased(CalendarProviderPush)
    replaced = (
        select(queued.id)
        .where(
            queued.event_id == CalendarProviderPush.event_id,
            queued.connected_calendar_id == CalendarProviderPush.connected_calendar_id,
            queued.operation == CalendarProviderPush.operation,
            queued.occurrence_date.is_not_distinct_from(CalendarProviderPush.occurrence_date),
            queued.state == PushState.PENDING,
        )
        .exists()
    )
    await session.execute(
        update(CalendarProviderPush)
        .where(stranded, replaced)
        .values(state=PushState.DONE, last_error_code=SUPERSEDED, updated_at=now)
    )
    await session.execute(
        update(CalendarProviderPush)
        .where(stranded)
        .values(state=PushState.PENDING, next_attempt_at=now, updated_at=now)
    )


async def _lease_pushes(session: AsyncSession, now: datetime) -> list[tuple[UUID, int]]:
    rows = (
        await session.execute(
            owned_by_live_member(
                select(
                    CalendarProviderPush.id,
                    CalendarProviderPush.generation,
                    CalendarConnection.organization_id,
                    CalendarConnection.owner_id,
                )
                .join(
                    ConnectedCalendar,
                    ConnectedCalendar.id == CalendarProviderPush.connected_calendar_id,
                )
                .join(CalendarConnection, CalendarConnection.id == ConnectedCalendar.connection_id)
            )
            .where(
                CalendarProviderPush.state == PushState.PENDING,
                CalendarProviderPush.next_attempt_at <= now,
            )
            .order_by(CalendarProviderPush.next_attempt_at)
            .limit(_DISPATCH_BATCH)
            .with_for_update(of=CalendarProviderPush, skip_locked=True)
        )
    ).all()
    allowed, refused = await _admitted(session, list(rows))
    for ids, due in (
        ([row.id for row in allowed], now + _LEASE),
        ([row.id for row in refused], now + PAUSED_RECHECK),
    ):
        if ids:
            await session.execute(
                update(CalendarProviderPush)
                .where(CalendarProviderPush.id.in_(ids))
                .values(next_attempt_at=due)
            )
    return [(row.id, row.generation) for row in allowed]


async def _enqueue(ref: JobRef, item_id: str, generation: int, *, job_id: str) -> int:
    # The core fleet holds only its own queue pool; this one opens the egress pool on demand.
    try:
        result = await enqueue_job_reconnecting(ref, item_id, generation, _job_id=job_id)
    except Exception:
        logger.opt(exception=True).warning("Calendar provider job enqueue failed", job=ref.name)
        return 0
    if result.outcome in _QUEUED:
        return 1
    # The lease lapses and the next run picks the row up again.
    logger.warning("Calendar provider job not queued", job=ref.name, item_id=item_id)
    return 0


async def wake(ref: JobRef, item_id: UUID, generation: int) -> None:
    """Start provider work now instead of at the next dispatch; the dispatch is the backstop."""
    await _enqueue(
        ref, str(item_id), generation, job_id=f"{ref.name}:{item_id}:{datetime.now(UTC).isoformat()}"
    )


async def _locked(key: str, ttl: int, work: Callable[[], Awaitable[dict]]) -> dict:
    client = get_ops_client()
    token = None
    if client is not None:
        try:
            token = await acquire_owned_job_lock(client, key, ttl)
        except Exception:
            logger.warning("Calendar provider lock unavailable", key=key)
        else:
            if token is None:
                return {"status": SyncStatus.SKIPPED.value, "reason": "lock_held"}
    try:
        return await work()
    finally:
        if client is not None and token is not None:
            try:
                await release_owned_job_lock(client, key, token)
            except Exception:
                logger.warning("Calendar provider lock not released", key=key)


def _parse(value: str) -> UUID | None:
    try:
        return UUID(value)
    except ValueError:
        return None


async def discover_connection_calendars(
    ctx: dict[str, Any], connection_id: str, generation: int
) -> dict:
    cid = _parse(connection_id)
    if cid is None:
        return {"status": "skipped"}

    async def work() -> dict:
        try:
            async with open_session() as session:
                report = await run_discovery(session, cid, int(generation))
        except Exception as exc:
            logger.error(
                "Calendar discovery crashed",
                connection_id=str(cid),
                traceback="".join(traceback.format_exception(exc)),
            )
            return {"status": "failed"}
        for started in report.get("started") or []:
            await wake(SYNC_CONNECTED_CALENDAR, UUID(str(started)), int(generation))
        return report

    return await _locked(
        f"calendar_connection:{cid}:discovery", DISCOVERY_JOB_TIMEOUT_SECONDS + 30, work
    )


async def sync_connected_calendar(
    ctx: dict[str, Any], connected_calendar_id: str, generation: int
) -> dict:
    cid = _parse(connected_calendar_id)
    if cid is None:
        return {"status": SyncStatus.SKIPPED.value}

    async def work() -> dict:
        try:
            async with open_session() as session:
                report = await run_sync(session, cid, int(generation), ctx[SEARCH_INDEXER_CTX_KEY])
            return report.as_dict()
        except Exception as exc:
            # No ARQ retry: the lease brings the row back, so a broken provider is not hammered.
            # A plain traceback: the sinks' variable dumps would print tokens.
            logger.error(
                "Connected calendar sync crashed",
                connected_calendar_id=str(cid),
                traceback="".join(traceback.format_exception(exc)),
            )
            return {"status": SyncStatus.FAILED.value}

    return await _locked(f"connected_calendar:{cid}:sync", SYNC_JOB_TIMEOUT_SECONDS + 30, work)


async def push_calendar_change(ctx: dict[str, Any], push_id: str, generation: int) -> dict:
    pid = _parse(push_id)
    if pid is None:
        return {"status": "skipped"}

    async def work() -> dict:
        try:
            async with open_session() as session:
                return await run_push(session, pid, int(generation), ctx[SEARCH_INDEXER_CTX_KEY])
        except Exception as exc:
            logger.error(
                "Calendar provider push crashed",
                push_id=str(pid),
                traceback="".join(traceback.format_exception(exc)),
            )
            return {"status": "failed"}

    return await _locked(f"calendar_push:{pid}", PUSH_JOB_TIMEOUT_SECONDS + 30, work)
