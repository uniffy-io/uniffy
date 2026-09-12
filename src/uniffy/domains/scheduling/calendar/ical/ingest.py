"""Turning a parsed calendar into rows, in one transaction."""

from dataclasses import dataclass
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.references import extract_all_outgoing_references
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.exception import RecurrenceException
from uniffy.core.types import AccessMode, EventTransparency
from uniffy.domains.scheduling.calendar.ical.parse import (
    ParsedEvent,
    SkippedEntry,
    parse_calendar,
)
from uniffy.domains.scheduling.calendar.queries import require_own_calendar
from uniffy.domains.scheduling.calendar.search import CalendarEventProjection

logger = logger.bind(component="scheduling.calendar.ical.ingest")


@dataclass(frozen=True)
class ImportPreview:
    """What an apply would do, without doing any of it."""

    creatable: tuple[ParsedEvent, ...]
    duplicates: tuple[ParsedEvent, ...]
    skipped: tuple[SkippedEntry, ...]


@dataclass(frozen=True)
class ImportOutcome:
    created_ids: tuple[UUID, ...]
    duplicate_count: int
    skipped: tuple[SkippedEntry, ...]


async def preview_import(
    session: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
    calendar_id: UUID,
    payload: bytes,
) -> ImportPreview:
    await require_own_calendar(session, user_id, organization_id, calendar_id)
    parsed = parse_calendar(payload)
    present = await _existing_uids(session, calendar_id, [event.ical_uid for event in parsed.events])

    creatable = tuple(event for event in parsed.events if event.ical_uid not in present)
    duplicates = tuple(event for event in parsed.events if event.ical_uid in present)
    return ImportPreview(creatable=creatable, duplicates=duplicates, skipped=parsed.skipped)


async def apply_import(
    session: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
    calendar_id: UUID,
    payload: bytes,
    projection: CalendarEventProjection | None = None,
) -> ImportOutcome:
    """Create everything the file describes that is not already here.

    One transaction covers the whole file: a partial import would leave a
    series without its exclusions, which reads as a different meeting.
    """
    preview = await preview_import(
        session,
        user_id=user_id,
        organization_id=organization_id,
        calendar_id=calendar_id,
        payload=payload,
    )

    created: list[CalendarEvent] = []
    try:
        for parsed in preview.creatable:
            master = _stage_event(
                session,
                parsed,
                user_id=user_id,
                organization_id=organization_id,
                calendar_id=calendar_id,
            )
            created.append(master)
            await session.flush()

            for occurrence in parsed.cancelled_dates:
                session.add(
                    RecurrenceException(
                        event_id=master.id,
                        original_date=occurrence,
                        is_cancelled=True,
                    )
                )

            for override in parsed.overrides:
                moved = _stage_event(
                    session,
                    override.event,
                    user_id=user_id,
                    organization_id=organization_id,
                    calendar_id=calendar_id,
                    recurrence_id=master.id,
                    # The series already carries the file's UID, and the
                    # partial index would refuse a second row holding it.
                    ical_uid=None,
                )
                await session.flush()
                session.add(
                    RecurrenceException(
                        event_id=master.id,
                        original_date=override.original_date,
                        is_cancelled=True,
                        override_event_id=moved.id,
                    )
                )

        await session.commit()
    except Exception:
        await session.rollback()
        raise

    await _index_after_commit(created, projection)

    return ImportOutcome(
        created_ids=tuple(event.id for event in created),
        duplicate_count=len(preview.duplicates),
        skipped=preview.skipped,
    )


def _stage_event(
    session: AsyncSession,
    parsed: ParsedEvent,
    *,
    user_id: UUID,
    organization_id: UUID,
    calendar_id: UUID,
    recurrence_id: UUID | None = None,
    ical_uid: str | None = "",
) -> CalendarEvent:
    """Add one row to the caller's transaction without committing it.

    Imported events are OWNER_ONLY like every other created event; the file
    names attendees by email, and mapping those to members is out of scope, so
    an imported event starts private to whoever imported it.
    """
    event = CalendarEvent(
        organization_id=organization_id,
        organizer_id=user_id,
        calendar_id=calendar_id,
        title=parsed.title,
        description=parsed.description,
        start_time=parsed.start_time,
        end_time=parsed.end_time,
        is_all_day=parsed.is_all_day,
        timezone=parsed.timezone,
        location=parsed.location,
        meeting_url=parsed.meeting_url,
        access_mode=AccessMode.OWNER_ONLY,
        status=parsed.status,
        visibility=parsed.visibility,
        transparency=(EventTransparency.TRANSPARENT if parsed.is_all_day else parsed.transparency),
        recurrence_pattern=parsed.recurrence_pattern,
        recurrence_config=parsed.recurrence_config,
        recurrence_id=recurrence_id,
        ical_uid=parsed.ical_uid if ical_uid == "" else ical_uid,
        outgoing_references=(
            extract_all_outgoing_references(parsed.description, organization_id)
            if parsed.description
            else None
        ),
    )
    session.add(event)
    return event


async def _existing_uids(session: AsyncSession, calendar_id: UUID, uids: list[str]) -> set[str]:
    if not uids:
        return set()
    rows = await session.execute(
        select(CalendarEvent.ical_uid).where(
            CalendarEvent.calendar_id == calendar_id,
            CalendarEvent.ical_uid.in_(uids),
        )
    )
    return {uid for uid in rows.scalars().all() if uid}


async def _index_after_commit(
    events: list[CalendarEvent], projection: CalendarEventProjection | None
) -> None:
    """Search projection is a post-commit effect, exactly as create() treats it:
    a stale index never fails an import that already landed.
    """
    if projection is None or not events:
        return
    for event in events:
        try:
            await projection.index(event)
        except Exception:  # noqa: BLE001
            logger.opt(exception=True).warning(
                "Imported event has a stale search projection", event_id=str(event.id)
            )
