"""Queue a Uniffy edit for the two-way provider calendars it touches, in the edit's transaction."""

import asyncio
from collections.abc import Sequence
from datetime import UTC, date, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import delete, event, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.jobs import enqueue_job_reconnecting
from uniffy.core.models.calendar.connection import (
    CalendarConnection,
    ConnectedCalendar,
    ConnectedCalendarState,
    ConnectionStatus,
    SyncDirection,
)
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.exception import RecurrenceException
from uniffy.core.models.calendar.link import CalendarEventLink
from uniffy.core.models.calendar.provider_push import (
    CalendarProviderPush,
    PushOperation,
    PushState,
)
from uniffy.domains.scheduling.calendar.jobs.contracts import PUSH_CALENDAR_CHANGE
from uniffy.domains.scheduling.calendar.policy import resolve_calendar_policy

logger = logger.bind(component="scheduling.calendar.connections.outbox")

# Set by inbound sync: a change that came from the provider never goes back to it.
PROVIDER_SYNC_FLAG = "provider_sync"
_WAKE_KEY = "calendar_provider_pushes"
_LIVE_STATUSES = (ConnectionStatus.ACTIVE, ConnectionStatus.PAUSED, ConnectionStatus.REAUTH_REQUIRED)


async def stage_provider_push(
    session: AsyncSession,
    *,
    organization_id: UUID,
    event_ids: Sequence[UUID],
    operation: PushOperation,
    actor_id: UUID | None,
    occurrence_date: date | None = None,
) -> None:
    """Never commits; the dispatcher delivers the row even if the wakeup after commit is lost."""
    if session.info.get(PROVIDER_SYNC_FLAG) or not event_ids:
        return
    policy = await resolve_calendar_policy(session, organization_id)
    if not policy.provider_writes_enabled():
        return
    for event_id in event_ids:
        await _stage_one(session, organization_id, event_id, operation, actor_id, occurrence_date)


async def _stage_one(
    session: AsyncSession,
    organization_id: UUID,
    event_id: UUID,
    operation: PushOperation,
    actor_id: UUID | None,
    occurrence_date: date | None,
) -> None:
    row = await session.get(CalendarEvent, event_id)
    if row is None or row.organization_id != organization_id:
        return
    removed = operation == PushOperation.DELETE or row.is_deleted
    if row.recurrence_id is not None and operation in (PushOperation.UPSERT, PushOperation.DELETE):
        # An edited occurrence is pushed as a change to that instance of its series.
        original = await session.scalar(
            select(RecurrenceException.original_date).where(
                RecurrenceException.override_event_id == row.id
            )
        )
        if original is None:
            return
        operation = PushOperation.DELETE_OCCURRENCE if removed else PushOperation.UPSERT_OCCURRENCE
        occurrence_date = original
        event_id = row.recurrence_id
        # Only that one instance goes; the series itself stays.
        removed = False
    if row.is_mirrored_occurrence:
        return

    if operation == PushOperation.RSVP:
        targets = await _own_copies(session, event_id, actor_id)
        for connected, generation, provider_event_id in targets:
            await _upsert(
                session,
                organization_id,
                event_id,
                connected,
                generation,
                operation,
                actor_id,
                None,
                provider_event_id,
            )
        return

    owner_links = await _owner_links(session, event_id)
    home = await _two_way_calendar(session, row.calendar_id)
    for connected_id, generation, provider_event_id in owner_links:
        if home is not None and connected_id == home[0]:
            continue
        # The event left this calendar (moved or deleted): remove it there.
        await _upsert(
            session,
            organization_id,
            event_id,
            connected_id,
            generation,
            PushOperation.DELETE,
            actor_id,
            None,
            provider_event_id,
        )
    if home is None:
        return
    connected_id, generation = home
    linked = next((link for link in owner_links if link[0] == connected_id), None)
    if removed:
        await _drop_pending(session, event_id, connected_id)
        if linked is None and not await _create_in_flight(session, event_id, connected_id):
            # Never reached the provider; dropping the queued create is the whole delete.
            return
        # A create still in flight is waited for; the delete then finds the link it left.
        await _upsert(
            session,
            organization_id,
            event_id,
            connected_id,
            generation,
            PushOperation.DELETE,
            actor_id,
            None,
            linked[2] if linked else None,
        )
        return
    if operation == PushOperation.UPSERT:
        # Moved away and back before the delete ran: the event belongs here after all.
        await session.execute(
            delete(CalendarProviderPush).where(
                CalendarProviderPush.event_id == event_id,
                CalendarProviderPush.connected_calendar_id == connected_id,
                CalendarProviderPush.operation == PushOperation.DELETE,
                CalendarProviderPush.state == PushState.PENDING,
            )
        )
    await _upsert(
        session,
        organization_id,
        event_id,
        connected_id,
        generation,
        operation,
        actor_id,
        occurrence_date,
        linked[2] if linked else None,
    )


async def _create_in_flight(session: AsyncSession, event_id: UUID, connected_id: UUID) -> bool:
    found = await session.scalar(
        select(CalendarProviderPush.id)
        .where(
            CalendarProviderPush.event_id == event_id,
            CalendarProviderPush.connected_calendar_id == connected_id,
            CalendarProviderPush.operation == PushOperation.UPSERT,
            CalendarProviderPush.state == PushState.IN_FLIGHT,
        )
        .limit(1)
    )
    return found is not None


async def _two_way_calendar(session: AsyncSession, calendar_id: UUID) -> tuple[UUID, int] | None:
    row = (
        await session.execute(
            select(ConnectedCalendar.id, CalendarConnection.generation)
            .join(CalendarConnection, CalendarConnection.id == ConnectedCalendar.connection_id)
            .where(
                ConnectedCalendar.calendar_id == calendar_id,
                ConnectedCalendar.state == ConnectedCalendarState.ACTIVE,
                ConnectedCalendar.sync_enabled.is_(True),
                ConnectedCalendar.direction == SyncDirection.TWO_WAY,
                CalendarConnection.status.in_(_LIVE_STATUSES),
            )
        )
    ).first()
    return (row[0], row[1]) if row is not None else None


async def _owner_links(session: AsyncSession, event_id: UUID) -> list[tuple[UUID, int, str]]:
    rows = await session.execute(
        select(
            CalendarEventLink.connected_calendar_id,
            CalendarConnection.generation,
            CalendarEventLink.provider_event_id,
        )
        .join(ConnectedCalendar, ConnectedCalendar.id == CalendarEventLink.connected_calendar_id)
        .join(CalendarConnection, CalendarConnection.id == ConnectedCalendar.connection_id)
        .where(
            CalendarEventLink.event_id == event_id,
            CalendarEventLink.is_owner_link.is_(True),
            CalendarEventLink.occurrence_key.is_(None),
            ConnectedCalendar.direction == SyncDirection.TWO_WAY,
            ConnectedCalendar.state == ConnectedCalendarState.ACTIVE,
            CalendarConnection.status.in_(_LIVE_STATUSES),
        )
    )
    return [(row[0], row[1], row[2]) for row in rows.all()]


async def _own_copies(
    session: AsyncSession, event_id: UUID, actor_id: UUID | None
) -> list[tuple[UUID, int, str]]:
    """The responder's own copies of the meeting; an answer belongs on the responder's calendar."""
    if actor_id is None:
        return []
    rows = await session.execute(
        select(
            CalendarEventLink.connected_calendar_id,
            CalendarConnection.generation,
            CalendarEventLink.provider_event_id,
        )
        .join(ConnectedCalendar, ConnectedCalendar.id == CalendarEventLink.connected_calendar_id)
        .join(CalendarConnection, CalendarConnection.id == ConnectedCalendar.connection_id)
        .where(
            CalendarEventLink.event_id == event_id,
            CalendarConnection.owner_id == actor_id,
            ConnectedCalendar.direction == SyncDirection.TWO_WAY,
            ConnectedCalendar.state == ConnectedCalendarState.ACTIVE,
            CalendarConnection.status.in_(_LIVE_STATUSES),
        )
    )
    return [(row[0], row[1], row[2]) for row in rows.all()]


async def _drop_pending(session: AsyncSession, event_id: UUID, connected_id: UUID) -> None:
    await session.execute(
        delete(CalendarProviderPush).where(
            CalendarProviderPush.event_id == event_id,
            CalendarProviderPush.connected_calendar_id == connected_id,
            CalendarProviderPush.state == PushState.PENDING,
        )
    )


async def _upsert(
    session: AsyncSession,
    organization_id: UUID,
    event_id: UUID,
    connected_id: UUID,
    generation: int,
    operation: PushOperation,
    actor_id: UUID | None,
    occurrence_date: date | None,
    provider_event_id: str | None,
) -> None:
    now = datetime.now(UTC)
    statement = (
        pg_insert(CalendarProviderPush)
        .values(
            organization_id=organization_id,
            event_id=event_id,
            connected_calendar_id=connected_id,
            actor_id=actor_id,
            operation=operation,
            occurrence_date=occurrence_date,
            provider_event_id=provider_event_id,
            state=PushState.PENDING,
            attempts=0,
            next_attempt_at=now,
            generation=generation,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_update(
            index_elements=[
                CalendarProviderPush.event_id,
                CalendarProviderPush.connected_calendar_id,
                CalendarProviderPush.operation,
                text("coalesce(occurrence_date, '1970-01-01'::date)"),
            ],
            index_where=text("state = 'PENDING'"),
            set_={
                "updated_at": now,
                "next_attempt_at": now,
                "actor_id": actor_id,
                "generation": generation,
                "provider_event_id": provider_event_id,
            },
        )
        .returning(CalendarProviderPush.id)
    )
    push_id = await session.scalar(statement)
    if push_id is not None:
        _wake_after_commit(session, push_id, generation)


def _wake_after_commit(session: AsyncSession, push_id: UUID, generation: int) -> None:
    pending: list[tuple[UUID, int]] | None = session.info.get(_WAKE_KEY)
    if pending is None:
        pending = []
        session.info[_WAKE_KEY] = pending
        sync_session = session.sync_session

        def after_commit(*_args: object) -> None:
            woken = list(session.info.pop(_WAKE_KEY, []))
            if not woken:
                return
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                return
            task = loop.create_task(_wake(woken))
            _BACKGROUND.add(task)
            task.add_done_callback(_BACKGROUND.discard)

        def after_rollback(*_args: object) -> None:
            session.info.pop(_WAKE_KEY, None)

        event.listen(sync_session, "after_commit", after_commit, once=True)
        event.listen(sync_session, "after_soft_rollback", after_rollback, once=True)
    pending.append((push_id, generation))


_BACKGROUND: set[asyncio.Task] = set()


async def _wake(pushes: list[tuple[UUID, int]]) -> None:
    stamp = datetime.now(UTC).isoformat()
    for push_id, generation in pushes:
        try:
            await enqueue_job_reconnecting(
                PUSH_CALENDAR_CHANGE,
                str(push_id),
                generation,
                _job_id=f"calendar-push:{push_id}:{stamp}",
            )
        except Exception:
            logger.warning("Calendar push wakeup deferred to the dispatcher", push_id=str(push_id))
