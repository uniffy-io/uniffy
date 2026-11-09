"""Who a provider lists on an event: every guest, and the members among them as attendees."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.participant import CalendarEventParticipant, ParticipantResponse
from uniffy.core.models.calendar.provider_push import CalendarProviderPush, PushState
from uniffy.core.models.shared import AttendeeRole, AttendeeStatus
from uniffy.domains.scheduling.calendar.connections.normalize import ProviderAttendee, ProviderEvent

RESPONSE_TO_STATUS = {
    ParticipantResponse.ACCEPTED: AttendeeStatus.ACCEPTED,
    ParticipantResponse.TENTATIVE: AttendeeStatus.TENTATIVE,
    ParticipantResponse.DECLINED: AttendeeStatus.DECLINED,
    ParticipantResponse.PENDING: AttendeeStatus.PENDING,
}


def own_status(
    item: ProviderEvent, default: AttendeeStatus = AttendeeStatus.PENDING
) -> AttendeeStatus:
    """The connected account's own answer, as the provider lists it among the guests."""
    own = next((person for person in item.attendees if person.is_self), None)
    return RESPONSE_TO_STATUS[own.response] if own is not None else default


class PeopleSync:
    def __init__(
        self,
        session: AsyncSession,
        organization_id: UUID,
        owner_id: UUID,
        members: dict[str, UUID],
    ) -> None:
        self.session = session
        self.organization_id = organization_id
        self.owner_id = owner_id
        self.members = members

    async def respond_as_attendee(self, event_id: UUID, item: ProviderEvent) -> bool:
        status = own_status(item)
        if status == AttendeeStatus.PENDING:
            return False
        return await self.update_response(event_id, status)

    async def update_response(self, event_id: UUID, status: AttendeeStatus) -> bool:
        # An attendee copy cannot restore access removed by the organizer.
        result = await self.session.execute(
            update(EventAttendee)
            .where(
                EventAttendee.event_id == event_id,
                EventAttendee.user_id == self.owner_id,
                EventAttendee.status != status,
            )
            .values(status=status, responded_at=datetime.now(UTC))
            .returning(EventAttendee.id)
        )
        return result.scalar_one_or_none() is not None

    async def ensure_attendee(
        self,
        event_id: UUID,
        user_id: UUID,
        status: AttendeeStatus,
        role: AttendeeRole | None = None,
        *,
        existing: dict[UUID, EventAttendee] | None = None,
    ) -> None:
        if existing is not None:
            row = existing.get(user_id)
        else:
            row = await self.session.scalar(
                select(EventAttendee).where(
                    EventAttendee.event_id == event_id, EventAttendee.user_id == user_id
                )
            )
        if row is None:
            row = EventAttendee(
                event_id=event_id,
                user_id=user_id,
                status=status,
                role=role or AttendeeRole.REQUIRED,
                responded_at=datetime.now(UTC) if status != AttendeeStatus.PENDING else None,
            )
            self.session.add(row)
            if existing is not None:
                existing[user_id] = row
            return
        if role is not None and row.role != role:
            row.role = role
        if row.status != status and status != AttendeeStatus.PENDING:
            row.status = status
            row.responded_at = datetime.now(UTC)

    async def sync(self, event_id: UUID, item: ProviderEvent) -> None:
        """Every guest is listed; members among them also become attendees with their answer."""
        await self.session.execute(
            delete(CalendarEventParticipant).where(CalendarEventParticipant.event_id == event_id)
        )
        listed: dict[str, ProviderAttendee] = {}
        for person in item.attendees:
            listed.setdefault(person.email, person)
        if item.organizer_email and item.organizer_email not in listed and not item.is_organizer:
            listed[item.organizer_email] = ProviderAttendee(
                email=item.organizer_email,
                display_name=item.organizer_name,
                response=ParticipantResponse.ACCEPTED,
                is_organizer=True,
            )
        event = await self.session.get(CalendarEvent, event_id)
        organizer_id = event.organizer_id if event is not None else None
        existing = {
            row.user_id: row
            for row in (
                await self.session.execute(
                    select(EventAttendee).where(EventAttendee.event_id == event_id)
                )
            ).scalars()
        }
        for person in listed.values():
            user_id = self.members.get(person.email)
            self.session.add(
                CalendarEventParticipant(
                    organization_id=self.organization_id,
                    event_id=event_id,
                    email=person.email[:320],
                    display_name=(person.display_name or None) and person.display_name[:255],
                    response=person.response,
                    is_organizer=person.is_organizer,
                    is_optional=person.is_optional,
                    user_id=user_id,
                )
            )
            if user_id is None:
                continue
            if user_id != organizer_id:
                await self.ensure_attendee(
                    event_id, user_id, RESPONSE_TO_STATUS[person.response], existing=existing
                )
            elif not person.is_organizer:
                # The owner of an invitation they did not send: their answer is their own.
                await self.ensure_attendee(
                    event_id,
                    user_id,
                    RESPONSE_TO_STATUS[person.response],
                    AttendeeRole.ORGANIZER,
                    existing=existing,
                )
        if not item.guests_hidden:
            await self._drop_unlisted_members(event_id, listed, organizer_id, set(existing))

    async def _drop_unlisted_members(
        self,
        event_id: UUID,
        listed: dict[str, ProviderAttendee],
        organizer_id: UUID | None,
        attending: set[UUID],
    ) -> None:
        pending = await self.session.scalar(
            select(CalendarProviderPush.id)
            .where(
                CalendarProviderPush.event_id == event_id,
                CalendarProviderPush.state.in_([PushState.PENDING, PushState.IN_FLIGHT]),
            )
            .limit(1)
        )
        if pending is not None:
            # A Uniffy edit is on its way out; the provider has not seen its guests yet.
            return
        listed_users = {self.members[email] for email in listed if email in self.members}
        # Only attendees the provider could have listed: members with a known address.
        known_users = set(self.members.values())
        keep = listed_users | {organizer_id, self.owner_id}
        removable = list((attending & known_users) - keep)
        if removable:
            await self.session.execute(
                delete(EventAttendee).where(
                    EventAttendee.event_id == event_id, EventAttendee.user_id.in_(removable)
                )
            )
