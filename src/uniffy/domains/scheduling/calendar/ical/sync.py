"""Mirror a parsed feed onto its calendar, entry by entry."""

import hashlib
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import delete, insert, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.json_codec import OPTION_SORT_KEYS, dumps_bytes
from uniffy.core.models.calendar.activity import EventActivity
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.exception import RecurrenceException
from uniffy.core.models.calendar.reminder import EventReminder
from uniffy.core.models.calendar.subscription import CalendarSubscription
from uniffy.core.models.rooms.booking import RoomBooking
from uniffy.core.types import generate_id
from uniffy.domains.scheduling.calendar.ical.parse import ParsedCalendar, ParsedEvent
from uniffy.domains.scheduling.calendar.ical.rows import build_event

# Twenty-odd columns per event keeps a chunk well under PostgreSQL's 32,767 bind parameters.
_CHUNK = 1000

# Columns a changed entry rewrites in place, so the event keeps its id and any open view of it.
_MUTABLE_COLUMNS = (
    "title",
    "description",
    "start_time",
    "end_time",
    "is_all_day",
    "timezone",
    "location",
    "meeting_url",
    "status",
    "visibility",
    "transparency",
    "recurrence_pattern",
    "recurrence_config",
)


@dataclass(frozen=True)
class SyncOutcome:
    created: int
    updated: int
    deleted: int
    unchanged: int
    # Every row written (series and moved occurrences) and every row removed, for search.
    written_ids: tuple[UUID, ...] = ()
    removed_ids: tuple[UUID, ...] = ()
    # Series rewritten in place: the only rows an open mention can already show.
    rewritten_ids: tuple[UUID, ...] = ()

    @property
    def changed(self) -> bool:
        return bool(self.created or self.updated or self.deleted)


def fingerprint(parsed: ParsedEvent) -> str:
    """A digest of everything the entry would store; DTSTAMP is never read, so it cannot churn it."""
    return hashlib.sha256(dumps_bytes(parsed, option=OPTION_SORT_KEYS)).hexdigest()


@dataclass
class _Rows:
    events: list[dict[str, Any]]
    exceptions: list[dict[str, Any]]


async def stage_feed_sync(
    session: AsyncSession,
    *,
    organization_id: UUID,
    owner_id: UUID,
    calendar_id: UUID,
    parsed: ParsedCalendar,
) -> SyncOutcome:
    """Bring the calendar's rows in line with the feed; the caller owns the transaction."""
    existing = {
        row.ical_uid: row
        for row in (
            await session.execute(
                select(
                    CalendarEvent.id,
                    CalendarEvent.ical_uid,
                    CalendarEvent.ical_fingerprint,
                    CalendarEvent.ical_sequence,
                ).where(
                    CalendarEvent.calendar_id == calendar_id,
                    CalendarEvent.recurrence_id.is_(None),
                    CalendarEvent.ical_uid.is_not(None),
                )
            )
        ).all()
    }

    fresh = _Rows([], [])
    rewritten = _Rows([], [])
    rewrites: list[dict[str, Any]] = []
    unchanged = 0
    seen: set[str] = set()

    for entry in parsed.events:
        seen.add(entry.ical_uid)
        digest = fingerprint(entry)
        current = existing.get(entry.ical_uid)
        if current is None:
            master_id = generate_id()
            master = _event_row(entry, organization_id, owner_id, calendar_id, master_id)
            master["ical_fingerprint"] = digest
            fresh.events.append(master)
            _add_occurrences(fresh, entry, organization_id, owner_id, calendar_id, master_id)
            continue
        if current.ical_fingerprint == digest:
            unchanged += 1
            continue
        row = _event_row(entry, organization_id, owner_id, calendar_id, current.id)
        rewrite = {column: row[column] for column in _MUTABLE_COLUMNS}
        rewrite.update(
            id=current.id,
            ical_fingerprint=digest,
            ical_sequence=current.ical_sequence + 1,
            updated_at=datetime.now(UTC),
        )
        rewrites.append(rewrite)
        _add_occurrences(rewritten, entry, organization_id, owner_id, calendar_id, current.id)

    gone = [row.id for uid, row in existing.items() if uid not in seen]
    rewritten_ids = [rewrite["id"] for rewrite in rewrites]

    removed = await _delete_series(session, gone)
    if rewritten_ids:
        # A changed series is re-expanded from scratch: its moved and cancelled
        # occurrences are cheaper to replace than to diff.
        removed += await _delete_occurrences(session, rewritten_ids)
        for chunk in _chunks(rewrites):
            await session.execute(update(CalendarEvent), chunk)
    await _insert(session, fresh)
    await _insert(session, rewritten)

    return SyncOutcome(
        created=len(fresh.events) - _override_count(fresh),
        updated=len(rewrites),
        deleted=len(gone),
        unchanged=unchanged,
        written_ids=(
            *rewritten_ids,
            *(row["id"] for row in fresh.events),
            *(row["id"] for row in rewritten.events),
        ),
        removed_ids=tuple(removed),
        rewritten_ids=tuple(rewritten_ids),
    )


@dataclass(frozen=True)
class FeedPurge:
    series: int
    removed_ids: tuple[UUID, ...]


async def stage_feed_purge(session: AsyncSession, calendar_id: UUID) -> FeedPurge:
    """Remove every mirrored event and the subscription behind a calendar being retired."""
    masters = list(
        (
            await session.execute(
                select(CalendarEvent.id).where(
                    CalendarEvent.calendar_id == calendar_id,
                    CalendarEvent.recurrence_id.is_(None),
                )
            )
        ).scalars()
    )
    removed = await _delete_series(session, masters)
    await session.execute(
        delete(CalendarSubscription).where(CalendarSubscription.calendar_id == calendar_id)
    )
    return FeedPurge(series=len(masters), removed_ids=tuple(removed))


def _event_row(
    entry: ParsedEvent,
    organization_id: UUID,
    owner_id: UUID,
    calendar_id: UUID,
    event_id: UUID,
    *,
    recurrence_id: UUID | None = None,
) -> dict[str, Any]:
    event = build_event(
        entry,
        organization_id=organization_id,
        organizer_id=owner_id,
        calendar_id=calendar_id,
        recurrence_id=recurrence_id,
        # The series carries the UID; the partial unique index refuses a second holder.
        ical_uid=entry.ical_uid if recurrence_id is None else None,
        # Feed text is someone else's: it never links into the workspace.
        with_references=False,
    )
    event.id = event_id
    return _columns(event)


def _add_occurrences(
    rows: _Rows,
    entry: ParsedEvent,
    organization_id: UUID,
    owner_id: UUID,
    calendar_id: UUID,
    master_id: UUID,
) -> None:
    moved: dict[date, UUID] = {}
    # One exception row exists per date, so only the last override for a date is kept;
    # an earlier one would be a stray occurrence nothing points at.
    latest = {override.original_date: override for override in entry.overrides}
    for override in latest.values():
        override_id = generate_id()
        rows.events.append(
            _event_row(
                override.event,
                organization_id,
                owner_id,
                calendar_id,
                override_id,
                recurrence_id=master_id,
            )
        )
        moved[override.original_date] = override_id
    for original_date, override_id in moved.items():
        rows.exceptions.append(_exception_row(master_id, original_date, override_id))
    for cancelled in entry.cancelled_dates:
        # A date both cancelled and overridden keeps the override.
        if cancelled not in moved:
            rows.exceptions.append(_exception_row(master_id, cancelled, None))


def _exception_row(master_id: UUID, original_date: date, override_id: UUID | None) -> dict:
    return _columns(
        RecurrenceException(
            event_id=master_id,
            original_date=original_date,
            is_cancelled=True,
            override_event_id=override_id,
        )
    )


def _columns(model: Any) -> dict[str, Any]:
    return {column.key: getattr(model, column.key) for column in model.__table__.columns}


def _override_count(rows: _Rows) -> int:
    return sum(1 for row in rows.events if row["recurrence_id"] is not None)


async def _insert(session: AsyncSession, rows: _Rows) -> None:
    # Masters first: overrides reference them, and exceptions reference both.
    masters = [row for row in rows.events if row["recurrence_id"] is None]
    overrides = [row for row in rows.events if row["recurrence_id"] is not None]
    for table_rows, model in (
        (masters, CalendarEvent),
        (overrides, CalendarEvent),
        (rows.exceptions, RecurrenceException),
    ):
        for chunk in _chunks(table_rows):
            await session.execute(insert(model.__table__), chunk)


async def _delete_series(session: AsyncSession, master_ids: Sequence[UUID]) -> list[UUID]:
    removed: list[UUID] = []
    for chunk in _chunks(master_ids):
        removed += await _delete_occurrences(session, chunk)
        await _delete_dependents(session, chunk)
        await session.execute(delete(CalendarEvent).where(CalendarEvent.id.in_(chunk)))
        removed += chunk
    return removed


async def _delete_occurrences(session: AsyncSession, master_ids: Sequence[UUID]) -> list[UUID]:
    """A series' exceptions and moved-occurrence rows, leaving the master itself."""
    overrides = list(
        (
            await session.execute(
                select(CalendarEvent.id).where(CalendarEvent.recurrence_id.in_(master_ids))
            )
        ).scalars()
    )
    await session.execute(
        delete(RecurrenceException).where(
            or_(
                RecurrenceException.event_id.in_(master_ids),
                RecurrenceException.override_event_id.in_(overrides),
            )
        )
    )
    for chunk in _chunks(overrides):
        await _delete_dependents(session, chunk)
        await session.execute(delete(CalendarEvent).where(CalendarEvent.id.in_(chunk)))
    return overrides


async def _delete_dependents(session: AsyncSession, event_ids: Sequence[UUID]) -> None:
    # Feed events are read-only, so these rows should never exist; the deletes
    # keep a stray one from blocking the sync on a foreign key.
    for model in (EventReminder, EventActivity, EventAttendee):
        await session.execute(delete(model).where(model.event_id.in_(event_ids)))
    await session.execute(
        update(RoomBooking).where(RoomBooking.event_id.in_(event_ids)).values(event_id=None)
    )


def _chunks[T](items: Sequence[T] | Iterable[T]) -> Iterable[list[T]]:
    batch: list[T] = []
    for item in items:
        batch.append(item)
        if len(batch) == _CHUNK:
            yield batch
            batch = []
    if batch:
        yield batch
