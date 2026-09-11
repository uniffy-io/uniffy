"""Building and sending one event message."""

from dataclasses import dataclass, field
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.tokens import create_event_response_token
from uniffy.core.mail import MailSender
from uniffy.core.mail.parts import CalendarMethod, CalendarPart, MailAttachment
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.mail_delivery import (
    CalendarMailDelivery,
    CalendarMailKind,
)
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.user import User
from uniffy.core.types import NotificationType
from uniffy.domains.notifications.delivery.timing import resolve_timezone
from uniffy.domains.scheduling.calendar.ical.assemble import build_exports
from uniffy.domains.scheduling.calendar.ical.emit import EventExport, serialize_events
from uniffy.domains.scheduling.calendar.mail.context import (
    RespondLinks,
    build_context,
    respond_links,
)
from uniffy.domains.settings.defaults import wants_transactional_email

logger = logger.bind(component="scheduling.calendar.mail.compose")

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

# There is no CALENDAR_CHANGED notification type, and a member who wants
# invitations wants the updates to them, so changes follow the invite toggle.
_PREFERENCES: dict[CalendarMailKind, NotificationType] = {
    CalendarMailKind.INVITATION: NotificationType.CALENDAR_INVITE,
    CalendarMailKind.CHANGE: NotificationType.CALENDAR_INVITE,
    CalendarMailKind.CANCELLATION: NotificationType.CALENDAR_CANCELLED,
}


@dataclass
class EventMailBundle:
    """Everything shared by every recipient of one event's mail."""

    event: CalendarEvent
    organization: Organization
    organizer_name: str
    attendee_names: list[str] = field(default_factory=list)
    exports: list[EventExport] = field(default_factory=list)


async def load_bundle(session: AsyncSession, event_id: UUID) -> EventMailBundle | None:
    """Load the event and everyone on it once, for all of its pending mail."""
    event = await session.get(CalendarEvent, event_id)
    if event is None:
        return None
    organization = await session.get(Organization, event.organization_id)
    if organization is None:
        return None

    organizer = await session.get(User, event.organizer_id)
    names = (
        await session.execute(
            select(User.full_name, User.username, User.email)
            .join(EventAttendee, EventAttendee.user_id == User.id)
            .where(EventAttendee.event_id == event_id)
        )
    ).all()

    return EventMailBundle(
        event=event,
        organization=organization,
        organizer_name=_display_name(organizer),
        attendee_names=[full or username or email for full, username, email in names],
        exports=await build_exports(session, [event]),
    )


def build_message_document(bundle: EventMailBundle, delivery: CalendarMailDelivery) -> bytes:
    """The iCalendar body for one message.

    Withdrawing a single occurrence sends that occurrence alone, carrying a
    RECURRENCE-ID, rather than the series it belongs to.
    """
    method = _METHODS[delivery.kind]
    if delivery.occurrence_date is not None:
        return serialize_events(
            [
                EventExport(
                    event=bundle.event,
                    sequence=bundle.event.ical_sequence,
                    occurrence_date=delivery.occurrence_date,
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


async def send_delivery(
    session: AsyncSession,
    delivery: CalendarMailDelivery,
    bundle: EventMailBundle,
    *,
    sender: MailSender,
    overrides_loader,
    timezone_loader,
    changes: list[str] | None = None,
) -> bool:
    """Send one message, or report that the recipient did not want it.

    Returning False is a settled outcome, not a failure: the row is done.
    """
    recipient = await session.get(User, delivery.recipient_user_id)
    if recipient is None or not recipient.is_active:
        return False

    overrides = await overrides_loader(session, recipient.id)
    if not wants_transactional_email(_PREFERENCES[delivery.kind], overrides):
        return False

    document = build_message_document(bundle, delivery)
    context = build_context(
        bundle.event,
        organization_name=bundle.organization.name,
        organizer_name=bundle.organizer_name,
        recipient_timezone=str(resolve_timezone(await timezone_loader(session, recipient.id))),
        attendee_names=bundle.attendee_names,
        respond=_respond_links_for(delivery, recipient.id),
        changes=changes or [],
        occurrence_date=delivery.occurrence_date,
    )

    await sender.send(
        recipient_email=recipient.email,
        template_name=_TEMPLATES[delivery.kind],
        context=context,
        organization_id=delivery.organization_id,
        user_id=recipient.id,
        idempotency_key=f"calendar-mail:{delivery.id}",
        calendar_part=CalendarPart(document=document, method=_METHODS[delivery.kind]),
        attachments=[MailAttachment(filename=ATTACHMENT_FILENAME, content=document)],
    )
    return True


def _display_name(user: User | None) -> str:
    if user is None:
        return ""
    return user.full_name or user.username or user.email


def _respond_links_for(delivery: CalendarMailDelivery, recipient_id) -> RespondLinks:
    """A withdrawn meeting has nothing left to answer."""
    if delivery.kind is CalendarMailKind.CANCELLATION:
        return RespondLinks()
    return respond_links(
        create_event_response_token(recipient_id, delivery.organization_id, delivery.event_id)
    )
