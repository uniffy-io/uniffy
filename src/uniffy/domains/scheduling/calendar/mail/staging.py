"""Staging event mail from the operations that cause it."""

from collections.abc import Iterable
from datetime import date
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.domains.scheduling.calendar.mail.outbox import CalendarMailKind, stage_event_mail

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
    """Tell everyone already invited that the meeting moved.

    The actions travel with the row: several edits coalesce onto one message,
    and their union is what the recipient needs to read.
    """
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
    """Tell every attendee the meeting, or this occurrence of it, is off.

    The revision moves with the withdrawal: a client that already holds the
    meeting ignores a cancellation whose sequence has not advanced.
    """
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


def describe_changes(actions: Iterable[str]) -> list[str]:
    """Human lines for the actions seen, in a stable order.

    Aspects rather than a diff: several edits coalesce into one message, and
    "the time has changed" stays true however many times it moved, where a
    narrative of every intermediate value would read as noise.
    """
    seen = set(actions)
    return [CHANGE_LABELS[action] for action in CHANGE_LABELS if action in seen]


async def _attendee_ids(session: AsyncSession, event_id: UUID, *, exclude: set[UUID]) -> list[UUID]:
    rows = await session.execute(
        select(EventAttendee.user_id).where(EventAttendee.event_id == event_id)
    )
    return [user_id for user_id in rows.scalars().all() if user_id not in exclude]
