"""Building and sending one event message."""

from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.tokens import create_event_response_token
from uniffy.core.mail import MailResult, MailSender
from uniffy.core.mail.parts import CalendarMethod, CalendarPart, MailAttachment
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.login.user import User
from uniffy.domains.notifications.delivery.outbox import RecipientContext
from uniffy.domains.notifications.delivery.timing import resolve_timezone
from uniffy.domains.scheduling.calendar.ical.assemble import build_exports
from uniffy.domains.scheduling.calendar.ical.emit import EventExport, serialize_events
from uniffy.domains.scheduling.calendar.mail.context import (
    RespondLinks,
    build_context,
    respond_links,
)
from uniffy.domains.scheduling.calendar.mail.outbox import CalendarMailKind, EventMailRequest
from uniffy.domains.scheduling.calendar.mail.staging import describe_changes

ATTACHMENT_FILENAME = "invite.ics"

_TEMPLATES: dict[CalendarMailKind, str] = {
    CalendarMailKind.INVITATION: "calendar/invitation",
    CalendarMailKind.CHANGE: "calendar/change",
    CalendarMailKind.CANCELLATION: "calendar/cancellation",
}

_METHODS: dict[CalendarMailKind, CalendarMethod] = {
    CalendarMailKind.INVITATION: CalendarMethod.REQUEST,
    # An update is a fresh REQUEST at a higher sequence, not its own method.
    CalendarMailKind.CHANGE: CalendarMethod.REQUEST,
    CalendarMailKind.CANCELLATION: CalendarMethod.CANCEL,
}


@dataclass
class EventMailBundle:
    """Everything shared by every recipient of one event's mail."""

    event: CalendarEvent
    organizer_name: str
    attendee_ids: set[UUID] = field(default_factory=set)
    attendee_names: list[str] = field(default_factory=list)
    exports: list[EventExport] = field(default_factory=list)


async def load_bundle(session: AsyncSession, event_id: UUID) -> EventMailBundle | None:
    """Load the event and everyone on it once, for all of its pending mail."""
    event = await session.get(CalendarEvent, event_id)
    if event is None:
        return None

    organizer = await session.get(User, event.organizer_id)
    roster = (
        await session.execute(
            select(User.id, User.full_name, User.username, User.email)
            .join(EventAttendee, EventAttendee.user_id == User.id)
            .where(EventAttendee.event_id == event_id)
        )
    ).all()

    return EventMailBundle(
        event=event,
        organizer_name=_display_name(organizer),
        attendee_ids={user_id for user_id, _, _, _ in roster},
        attendee_names=[full or username or email for _, full, username, email in roster],
        # The document describes the meeting as its organizer sees it,
        # which is what everyone on the roster was invited to.
        exports=await build_exports(
            session,
            [event],
            viewer_id=event.organizer_id,
            organization_id=event.organization_id,
        ),
    )


def build_message_document(bundle: EventMailBundle, request: EventMailRequest) -> bytes:
    """The iCalendar body for one message.

    Withdrawing a single occurrence sends that occurrence alone, carrying a
    RECURRENCE-ID, rather than the series it belongs to.
    """
    method = _METHODS[request.kind]
    series = bundle.exports[0] if bundle.exports else None
    if request.occurrence_date is not None:
        # A withdrawal names the organizer and everyone it affects, or the
        # receiving client has nothing to match against its own copy.
        return serialize_events(
            [
                EventExport(
                    event=bundle.event,
                    organizer=series.organizer if series else None,
                    attendees=series.attendees if series else (),
                    sequence=bundle.event.ical_sequence,
                    occurrence_date=request.occurrence_date,
                )
            ],
            method=method.value,
        )
    exports = [
        EventExport(
            event=export.event,
            organizer=export.organizer,
            attendees=export.attendees,
            cancelled_dates=export.cancelled_dates,
            overrides=export.overrides,
            sequence=bundle.event.ical_sequence,
        )
        for export in bundle.exports
    ] or [EventExport(event=bundle.event, sequence=bundle.event.ical_sequence)]
    return serialize_events(exports, method=method.value)


async def send_event_mail(
    request: EventMailRequest,
    bundle: EventMailBundle,
    recipient: RecipientContext,
    *,
    sender: MailSender,
) -> MailResult:
    """Send one message; the caller owns what its outcome does to the row."""
    document = build_message_document(bundle, request)
    context = build_context(
        bundle.event,
        organization_name=recipient.organization.name,
        organizer_name=bundle.organizer_name,
        recipient_timezone=str(resolve_timezone(recipient.timezone)),
        attendee_names=bundle.attendee_names,
        respond=_respond_links_for(request),
        changes=describe_changes(request.changes),
        occurrence_date=request.occurrence_date,
    )

    return await sender.send(
        recipient_email=recipient.user.email,
        template_name=_TEMPLATES[request.kind],
        context=context,
        organization_id=request.organization_id,
        user_id=request.recipient_id,
        idempotency_key=f"calendar-mail:{request.delivery_id}",
        calendar_part=CalendarPart(document=document, method=_METHODS[request.kind]),
        attachments=[MailAttachment(filename=ATTACHMENT_FILENAME, content=document)],
    )


def _display_name(user: User | None) -> str:
    if user is None:
        return ""
    return user.full_name or user.username or user.email


def _respond_links_for(request: EventMailRequest) -> RespondLinks:
    """A withdrawn meeting has nothing left to answer."""
    if request.kind is CalendarMailKind.CANCELLATION:
        return RespondLinks()
    return respond_links(
        create_event_response_token(request.recipient_id, request.organization_id, request.event_id)
    )
