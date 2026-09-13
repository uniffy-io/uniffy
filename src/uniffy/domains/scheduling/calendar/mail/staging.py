"""Staging event mail from the operations that cause it."""

from collections.abc import Iterable
from datetime import UTC, date, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.login.user import User
from uniffy.core.types import ContentType
from uniffy.domains.permissions.access import ResourceAudienceResolver, ResourceKey
from uniffy.domains.scheduling.calendar.ical.emit import event_uid
from uniffy.domains.scheduling.calendar.mail.outbox import CalendarMailKind, stage_event_mail
from uniffy.domains.scheduling.calendar.mail.withdrawal import EventWithdrawal
from uniffy.domains.scheduling.calendar.recurrence import occurrence_start_for_date

# Activity actions that move what an attendee needs to know: when it happens,
# where, and how to join. A retitled meeting or an edited agenda does not
# warrant mailing everyone.
MAIL_TRIGGERING_ACTIONS: frozenset[str] = frozenset({
    "schedule_changed",
    "location_changed",
    "meeting_changed",
    "recurrence_changed",
})

CHANGE_LABELS: dict[str, str] = {
    "schedule_changed": "The time has changed",
    "recurrence_changed": "The repeat pattern has changed",
    "location_changed": "The location has changed",
    "meeting_changed": "The joining details have changed",
}


async def stage_change_mail(
    session: AsyncSession,
    event: CalendarEvent,
    *,
    actor_id: UUID,
    actions: Iterable[str],
    exclude: set[UUID] | None = None,
) -> int:
    """Coalesced edits retain every changed aspect."""
    recipients = await _attendee_ids(session, event.id, exclude={actor_id, *(exclude or set())})
    return await stage_event_mail(
        session,
        organization_id=event.organization_id,
        event_id=event.id,
        title=event.title,
        recipient_ids=recipients,
        kind=CalendarMailKind.CHANGE,
        actor_user_id=actor_id,
        changes=[action for action in actions if action in MAIL_TRIGGERING_ACTIONS],
    )


async def stage_cancellation_mail(
    session: AsyncSession,
    event: CalendarEvent,
    *,
    actor_id: UUID,
    occurrence_date: date | None = None,
    event_id: UUID | None = None,
) -> int:
    """Advance the revision so clients accept the cancellation."""
    target = event_id or event.id
    withdrawn = event if target == event.id else await session.get(CalendarEvent, target)
    if withdrawn is not None:
        withdrawn.ical_sequence += 1
    recipients = await _attendee_ids(session, target, exclude={actor_id})
    return await stage_event_mail(
        session,
        organization_id=event.organization_id,
        event_id=target,
        title=event.title,
        recipient_ids=recipients,
        kind=CalendarMailKind.CANCELLATION,
        actor_user_id=actor_id,
        occurrence_date=occurrence_date,
    )


async def stage_withdrawal_mail(
    session: AsyncSession,
    event: CalendarEvent,
    *,
    actor_id: UUID,
    occurrence_date: date | None = None,
    this_and_following: bool = False,
) -> int:
    """Authorize the withdrawal audience before deletion removes its access facts."""
    recipients = await _attendee_ids(session, event.id, exclude={actor_id})
    recipients = await ResourceAudienceResolver(session).filter_resource(
        organization_id=event.organization_id,
        key=ResourceKey(ContentType.CALENDAR_EVENT, event.id),
        candidate_user_ids=recipients,
    )
    event.ical_sequence += 1
    organizer = await session.get(User, event.organizer_id)
    if not recipients or organizer is None:
        return 0
    withdrawal = EventWithdrawal(
        uid=event_uid(event),
        organizer_email=organizer.email,
        sequence=event.ical_sequence,
        timestamp=datetime.now(UTC),
        occurrence_on=occurrence_date if event.is_all_day else None,
        occurrence_at=(
            occurrence_start_for_date(event.start_time, event.timezone, occurrence_date)
            if occurrence_date is not None and not event.is_all_day
            else None
        ),
        this_and_following=this_and_following,
    )
    return await stage_event_mail(
        session,
        organization_id=event.organization_id,
        event_id=event.id,
        title="Meeting cancelled",
        recipient_ids=recipients,
        kind=CalendarMailKind.CANCELLATION,
        actor_user_id=actor_id,
        occurrence_date=occurrence_date,
        withdrawal=withdrawal,
    )


def describe_changes(actions: Iterable[str]) -> list[str]:
    seen = set(actions)
    return [CHANGE_LABELS[action] for action in CHANGE_LABELS if action in seen]


async def _attendee_ids(session: AsyncSession, event_id: UUID, *, exclude: set[UUID]) -> list[UUID]:
    rows = await session.execute(
        select(EventAttendee.user_id).where(EventAttendee.event_id == event_id)
    )
    return [user_id for user_id in rows.scalars().all() if user_id not in exclude]
