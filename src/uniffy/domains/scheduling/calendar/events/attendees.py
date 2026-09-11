"""Calendar operations."""

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, select

from uniffy.core.errors import (
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from uniffy.core.events import (
    NotificationEvent,
    emit_notification,
)
from uniffy.core.events.realtime import ContentAccessAction
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.mail_delivery import CalendarMailKind
from uniffy.core.models.login.group import Group
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import (
    OrganizationMember,
)
from uniffy.core.models.login.user import User
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import (
    AttendeeRole,
    AttendeeStatus,
    ContentType,
    EventStatus,
    NotificationType,
)
from uniffy.domains.chat.lifecycle import ChannelCallLifecycle
from uniffy.domains.chat.rooms import RoomMembership, StagedRoomMembershipSync
from uniffy.domains.scheduling.calendar.mail.outbox import stage_event_mail

logger = logger.bind(component="scheduling.calendar.events.attendees")


@dataclass(frozen=True)
class StagedCalendarRoomMembership:
    membership: RoomMembership
    sync: StagedRoomMembershipSync


class AttendeeOperations:
    def __init__(self, events: object) -> None:
        self.events = events
        self.session = events.session

    async def add_attendees(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        attendee_ids: list[UUID],
        role: AttendeeRole = AttendeeRole.REQUIRED,
        *,
        call_lifecycle: ChannelCallLifecycle,
    ) -> CalendarEvent:
        """Add attendees to an existing event."""
        event = await self.events._fetch_by_id(event_id, organization_id)
        if not event:
            raise NotFoundError("CalendarEvent", event_id)

        await self.events._require_edit(user_id, organization_id, event)

        attendee_ids, invited_via = await self.events._expand_group_attendees(
            user_id, organization_id, attendee_ids
        )

        result = await self.session.execute(
            select(EventAttendee.user_id).where(EventAttendee.event_id == event_id)
        )
        existing_ids = {row[0] for row in result.all()}

        added_ids: list[UUID] = []
        for attendee_id in attendee_ids:
            if attendee_id not in existing_ids:
                attendee = EventAttendee(
                    event_id=event_id,
                    user_id=attendee_id,
                    status=AttendeeStatus.PENDING,
                    role=role,
                    invited_via_group_id=invited_via.get(attendee_id),
                )
                self.session.add(attendee)
                added_ids.append(attendee_id)

        if added_ids and event.reminders:
            await self.events._create_reminder_rows(event, added_ids, event.reminders)

        event.updated_at = datetime.now(UTC)

        if added_ids:
            await self.events._log_activity(
                event_id,
                user_id,
                "attendees_added",
                new_value=",".join(str(uid) for uid in added_ids),
            )

        staged_room = await self.events._stage_auto_created_room_members(
            event,
            added=added_ids,
            removed=[],
            call_lifecycle=call_lifecycle,
        )

        await stage_event_mail(
            self.session,
            organization_id=organization_id,
            event_id=event.id,
            recipient_ids=added_ids,
            kind=CalendarMailKind.INVITATION,
            actor_user_id=user_id,
        )

        await self.session.commit()
        await self.session.refresh(event)

        if added_ids:
            await self.events._refresh_search_attendees(event)
            await self.events._publish_attendee_access_change(
                event,
                added_ids,
                ContentAccessAction.GRANTED,
            )
            await emit_notification(
                NotificationEvent(
                    notification_type=NotificationType.CALENDAR_INVITE,
                    organization_id=organization_id,
                    actor_id=user_id,
                    title=f"Invited to: {event.title}",
                    source_urn=build_content_urn(ContentType.CALENDAR_EVENT, event.id),
                    target_user_ids=added_ids,
                )
            )

        await self.events._finish_auto_created_room_members(event, staged_room)

        return event

    async def update_attendee_role(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        target_user_id: UUID,
        role: AttendeeRole,
    ) -> CalendarEvent:
        """Flip an attendee between REQUIRED and OPTIONAL; the organizer row is fixed."""
        if role not in (AttendeeRole.REQUIRED, AttendeeRole.OPTIONAL):
            raise ValidationError("role", "Attendee role must be required or optional")

        event = await self.events._fetch_by_id(event_id, organization_id)
        if not event:
            raise NotFoundError("CalendarEvent", event_id)

        await self.events._require_edit(user_id, organization_id, event)

        attendee = (
            await self.session.execute(
                select(EventAttendee).where(
                    EventAttendee.event_id == event.id,
                    EventAttendee.user_id == target_user_id,
                )
            )
        ).scalar_one_or_none()
        if not attendee:
            raise NotFoundError("EventAttendee", target_user_id)
        if attendee.role == AttendeeRole.ORGANIZER:
            raise ValidationError("role", "The organizer's role cannot change")

        if attendee.role != role:
            previous = attendee.role
            attendee.role = role
            event.updated_at = datetime.now(UTC)
            await self.events._log_activity(
                event_id,
                user_id,
                "field_updated",
                field_id="attendee_role",
                previous_value=f"{target_user_id}:{previous.value}",
                new_value=f"{target_user_id}:{role.value}",
            )
            await self.session.commit()
            await self.session.refresh(event)

        return event

    async def remove_attendees(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        attendee_ids: list[UUID],
        *,
        call_lifecycle: ChannelCallLifecycle,
    ) -> CalendarEvent:
        """Remove attendees from an event."""
        event = await self.events._fetch_by_id(event_id, organization_id)
        if not event:
            raise NotFoundError("CalendarEvent", event_id)

        await self.events._require_edit(user_id, organization_id, event)

        if event.organizer_id in attendee_ids:
            raise PermissionDeniedError("remove", "event organizer")

        result = await self.session.execute(
            select(EventAttendee).where(
                and_(
                    EventAttendee.event_id == event_id,
                    EventAttendee.user_id.in_(attendee_ids),
                )
            )
        )
        removed_ids: list[UUID] = []
        for attendee in result.scalars().all():
            removed_ids.append(attendee.user_id)
            await self.session.delete(attendee)

        await self.events._delete_reminder_rows(event_id, user_ids=attendee_ids)

        event.updated_at = datetime.now(UTC)

        if removed_ids:
            await self.events._log_activity(
                event_id,
                user_id,
                "attendees_removed",
                previous_value=",".join(str(uid) for uid in removed_ids),
            )

        staged_room = await self.events._stage_auto_created_room_members(
            event,
            added=[],
            removed=removed_ids,
            call_lifecycle=call_lifecycle,
        )

        await self.session.commit()
        await self.session.refresh(event)

        if removed_ids:
            await self.events._refresh_search_attendees(event)
            await self.events._publish_attendee_access_change(
                event,
                removed_ids,
                ContentAccessAction.REVOKED,
            )

        await self.events._finish_auto_created_room_members(event, staged_room)

        return event

    async def update_attendee_status(
        self,
        user_id: UUID,
        organization_id: UUID,
        event_id: UUID,
        status: AttendeeStatus,
    ) -> bool:
        """Update the current user's attendee status for an event."""
        event = await self.events._fetch_by_id(event_id, organization_id)
        if not event:
            raise NotFoundError("CalendarEvent", event_id)

        # The attendee row alone authorises nothing: removal leaves it behind,
        # so a response rides the same resolver as a read, where the invitation
        # floor rechecks active membership.
        await self.events._require_view(user_id, organization_id, event)

        if event.status == EventStatus.CANCELLED:
            raise ValidationError("event", "Cannot respond to a cancelled event")

        result = await self.session.execute(
            select(EventAttendee).where(
                and_(
                    EventAttendee.event_id == event_id,
                    EventAttendee.user_id == user_id,
                )
            )
        )
        attendee = result.scalar_one_or_none()
        if not attendee:
            raise NotFoundError("EventAttendee", user_id)

        old_status = attendee.status
        attendee.status = status
        attendee.responded_at = datetime.now(UTC)
        attendee.updated_at = datetime.now(UTC)

        if status == AttendeeStatus.DECLINED:
            await self.events._delete_reminder_rows(event_id, user_ids=[user_id])
        elif (
            old_status == AttendeeStatus.DECLINED
            and status in (AttendeeStatus.ACCEPTED, AttendeeStatus.TENTATIVE)
            and event.reminders
        ):
            await self.events._create_reminder_rows(event, [user_id], event.reminders)

        if old_status != status:
            await self.events._log_activity(
                event_id,
                user_id,
                "response_changed",
                field_id="status",
                previous_value=old_status.value,
                new_value=status.value,
            )

        await self.session.commit()

        if event.organizer_id != user_id:
            status_label = status.value.lower()
            await emit_notification(
                NotificationEvent(
                    notification_type=NotificationType.CALENDAR_RESPONSE,
                    organization_id=organization_id,
                    actor_id=user_id,
                    title=f"RSVP {status_label}: {event.title}",
                    source_urn=build_content_urn(ContentType.CALENDAR_EVENT, event.id),
                    target_user_ids=[event.organizer_id],
                )
            )

        return True

    async def _expand_group_attendees(
        self,
        acting_user_id: UUID,
        organization_id: UUID,
        attendee_ids: list[UUID],
    ) -> tuple[list[UUID], dict[UUID, UUID]]:
        """Replace group ids with their active rosters, then keep only active org members.

        A group expands only from this org, and a private group only for an
        actor who can see its roster (group member or org admin) - reported
        as "not found" so existence does not leak. Ids that are neither an
        org group nor an active org member are dropped.

        Returns ``(resolved ids, user_id -> source group id)``. Direct user
        ids stay out of the map; a user in two invited groups keeps the first.
        """
        if not attendee_ids:
            return [], {}

        result = await self.session.execute(
            select(Group.id, Group.is_private).where(
                Group.id.in_(attendee_ids),
                Group.organization_id == organization_id,
            )
        )
        groups = {row[0]: row[1] for row in result.all()}
        group_ids = set(groups)

        if group_ids:
            private_ids = {gid for gid, is_private in groups.items() if is_private}
            if private_ids and not await self.events._is_org_admin(acting_user_id, organization_id):
                memberships = await self.session.execute(
                    select(GroupMember.group_id).where(
                        GroupMember.group_id.in_(private_ids),
                        GroupMember.user_id == acting_user_id,
                        GroupMember.is_active.is_(True),
                    )
                )
                visible = {row[0] for row in memberships.all()}
                hidden = private_ids - visible
                if hidden:
                    raise ValidationError("attendees", "group not found")

            result = await self.session.execute(
                select(GroupMember.group_id, GroupMember.user_id).where(
                    and_(
                        GroupMember.group_id.in_(group_ids),
                        GroupMember.is_active.is_(True),
                    )
                )
            )
            members_by_group: dict[UUID, list[UUID]] = {}
            for gid, uid in result.all():
                members_by_group.setdefault(gid, []).append(uid)
        else:
            members_by_group = {}

        seen: set[UUID] = set()
        resolved: list[UUID] = []
        provenance: dict[UUID, UUID] = {}
        for uid in attendee_ids:
            if uid in group_ids:
                continue
            if uid not in seen:
                seen.add(uid)
                resolved.append(uid)
        for gid in attendee_ids:
            if gid not in group_ids:
                continue
            for uid in members_by_group.get(gid, []):
                if uid not in seen:
                    seen.add(uid)
                    resolved.append(uid)
                    provenance[uid] = gid

        if not resolved:
            return [], {}
        active = await self.session.execute(
            select(OrganizationMember.user_id)
            .join(User, User.id == OrganizationMember.user_id)
            .join(Organization, Organization.id == OrganizationMember.organization_id)
            .where(
                OrganizationMember.user_id.in_(resolved),
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.is_active.is_(True),
                User.is_active.is_(True),
                Organization.deleted_at.is_(None),
                Organization.is_suspended.is_(False),
            )
        )
        active_ids = {row[0] for row in active.all()}
        return (
            [uid for uid in resolved if uid in active_ids],
            {uid: gid for uid, gid in provenance.items() if uid in active_ids},
        )

    async def _stage_auto_created_room_members(
        self,
        event: CalendarEvent,
        *,
        added: list[UUID],
        removed: list[UUID],
        call_lifecycle: ChannelCallLifecycle,
    ) -> StagedCalendarRoomMembership | None:
        if not (event.channel_auto_created and event.channel_id):
            return None
        add = [uid for uid in added if uid != event.organizer_id]
        remove = [uid for uid in removed if uid != event.organizer_id]
        if not add and not remove:
            return None

        membership = RoomMembership(
            self.session,
            search_indexer=self.events.search_indexer,
            call_lifecycle=call_lifecycle,
        )
        staged = await membership.stage_sync(
            event.organizer_id,
            event.organization_id,
            event.channel_id,
            added_user_ids=add,
            removed_user_ids=remove,
        )
        return StagedCalendarRoomMembership(membership=membership, sync=staged)

    async def _finish_auto_created_room_members(
        self,
        event: CalendarEvent,
        staged: StagedCalendarRoomMembership | None,
    ) -> None:
        if staged is None:
            return
        try:
            await staged.membership.finish_sync_after_commit(staged.sync)
        except Exception:
            logger.opt(exception=True).warning(
                "auto-created meeting room member sync failed",
                event_id=str(event.id),
                channel_id=str(event.channel_id),
            )
