"""Calendars as things a member creates, lists, hides, edits, and deletes.

Asserted on rows: what the calendar list returns to each member, which events a
hidden calendar removes from the grid, and where a deleted calendar's events end up.
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import delete, select

from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.models.notifications.email_delivery import NotificationEmailDelivery
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.search import SearchIndexer
from uniffy.core.types import (
    AccessMode,
    CalendarType,
    ContentRole,
    ContentType,
    RecurrencePattern,
    SubjectType,
    generate_id,
)
from uniffy.domains.permissions.members import ContentMembersOperations
from uniffy.domains.scheduling.calendar.calendars import operations as calendar_operations
from uniffy.domains.scheduling.calendar.calendars.operations import CalendarOperations
from uniffy.domains.scheduling.calendar.calendars.reader import CalendarReader, CalendarSection
from uniffy.domains.scheduling.calendar.events.reader import CalendarEventReader
from uniffy.domains.scheduling.calendar.mail.outbox import CalendarMailKind, read_event_mail
from uniffy.domains.scheduling.calendar.queries import ensure_default_calendar
from uniffy.domains.scheduling.calendar.rpc.calendars import _to_proto

pytestmark = pytest.mark.asyncio(loop_scope="session")

START = datetime.now(UTC).replace(microsecond=0) + timedelta(days=3)


def _operations(session) -> CalendarOperations:
    return CalendarOperations(session, AsyncMock(spec=SearchIndexer))


async def _listing(session, access, user_id, calendar_id):
    for listing in await CalendarReader(session).list_calendars(user_id, access.org_id):
        if listing.calendar.id == calendar_id:
            return listing
    return None


async def _event(session, access, calendar_id, *, organizer_id=None, title="sync") -> CalendarEvent:
    event = CalendarEvent(
        organization_id=access.org_id,
        organizer_id=organizer_id or access.member_id,
        calendar_id=calendar_id,
        title=f"{title}-{generate_id().hex[:8]}",
        start_time=START,
        end_time=START + timedelta(hours=1),
        access_mode=AccessMode.OWNER_ONLY,
    )
    session.add(event)
    await session.commit()
    return event


async def _grid(session, access, user_id) -> set:
    reader = CalendarEventReader(session)
    visibility = await CalendarReader(session).event_visibility_filter(user_id, access.org_id)
    events = await reader.get_events_in_range(
        user_id,
        access.org_id,
        START - timedelta(days=1),
        START + timedelta(days=1),
        visibility_filter=visibility,
    )
    return {event.id for event in events}


class TestCreate:
    async def test_a_team_calendar_starts_with_its_co_admins(self, session, access) -> None:
        calendar = await _operations(session).create_calendar(
            user_id=access.member_id,
            organization_id=access.org_id,
            name="  Release train  ",
            color="#8b5cf6",
            calendar_type=CalendarType.TEAM,
            admin_user_ids=[access.peer_id, access.member_id],
        )

        assert calendar.name == "Release train"
        assert calendar.access_mode is AccessMode.EXPLICIT_MEMBERS
        assert not calendar.is_default
        members = await ContentMembersOperations(session, AsyncMock()).list_members(
            access.member_id, access.org_id, ContentType.CALENDAR, calendar.id
        )
        assert [(m.subject_id, m.role) for m in members] == [(access.peer_id, ContentRole.ADMIN)]
        audit = await session.scalar(
            select(AuditEvent.id).where(
                AuditEvent.resource_id == calendar.id,
                AuditEvent.action == Action.CALENDAR_CREATED,
            )
        )
        assert audit is not None

    async def test_omitting_a_policy_creates_a_private_calendar(self, session, access) -> None:
        calendar = await _operations(session).create_calendar(
            user_id=access.member_id,
            organization_id=access.org_id,
            name="Side project",
            color="#3b82f6",
        )

        assert calendar.access_mode is AccessMode.OWNER_ONLY
        assert await _listing(session, access, access.peer_id, calendar.id) is None
        assert await _listing(session, access, access.admin_id, calendar.id) is None

    async def test_a_blank_name_is_refused(self, session, access) -> None:
        with pytest.raises(ValidationError):
            await _operations(session).create_calendar(
                user_id=access.member_id,
                organization_id=access.org_id,
                name="   ",
                color="#3b82f6",
            )


class TestList:
    async def test_sections_and_default_visibility(self, session, access) -> None:
        operations = _operations(session)
        mine = await ensure_default_calendar(session, access.org_id, access.peer_id)
        shared = await operations.create_calendar(
            user_id=access.member_id,
            organization_id=access.org_id,
            name="Interviews",
            color="#10b981",
            admin_user_ids=[access.peer_id],
        )
        org_wide = await operations.create_calendar(
            user_id=access.owner_id,
            organization_id=access.org_id,
            name="Company holidays",
            color="#f59e0b",
            access_mode=AccessMode.OPEN_TO_ORG,
            baseline_role=ContentRole.VIEWER,
        )

        own = await _listing(session, access, access.peer_id, mine.id)
        via_share = await _listing(session, access, access.peer_id, shared.id)
        via_org = await _listing(session, access, access.peer_id, org_wide.id)

        assert (own.section, own.is_hidden) == (CalendarSection.MINE, False)
        assert (via_share.section, via_share.is_hidden) == (CalendarSection.SHARED, False)
        assert (via_org.section, via_org.is_hidden) == (CalendarSection.ORGANIZATION, True)
        # A deactivated member lists nothing, even what is open to everyone.
        assert await CalendarReader(session).list_calendars(access.ghost_id, access.org_id) == []

    async def test_each_calendar_names_its_owner(self, session, access) -> None:
        """Every default is called alike, so clients label a colleague's by whose it is."""
        theirs = await ensure_default_calendar(session, access.org_id, access.member_id)
        theirs.access_mode = AccessMode.EXPLICIT_MEMBERS
        await session.commit()
        await ContentMembersOperations(session, AsyncMock(spec=SearchIndexer)).add_member(
            actor_user_id=access.member_id,
            organization_id=access.org_id,
            content_type=ContentType.CALENDAR,
            content_id=theirs.id,
            subject_type=SubjectType.USER,
            subject_id=access.peer_id,
            role=ContentRole.VIEWER,
        )
        mine = await ensure_default_calendar(session, access.org_id, access.peer_id)
        listings = await CalendarReader(session).list_calendars(access.peer_id, access.org_id)
        owner_names = {
            message.id: message.owner_name
            for message in await _to_proto(session, access.peer_id, access.org_id, listings)
        }
        users = {
            user.id: user.full_name or user.email
            for user in (
                await session.execute(
                    select(User).where(User.id.in_([access.member_id, access.peer_id]))
                )
            ).scalars()
        }

        assert owner_names[str(theirs.id)] == users[access.member_id]
        assert owner_names[str(mine.id)] == users[access.peer_id]


class TestVisibility:
    async def test_hiding_a_calendar_removes_its_events_and_persists(self, session, access) -> None:
        operations = _operations(session)
        team = await operations.create_calendar(
            user_id=access.member_id,
            organization_id=access.org_id,
            name="On call",
            color="#ef4444",
            admin_user_ids=[access.peer_id],
        )
        event = await _event(session, access, team.id)
        assert event.id in await _grid(session, access, access.peer_id)

        listing = await operations.set_visibility(access.peer_id, access.org_id, team.id, True)

        assert listing.is_hidden
        assert event.id not in await _grid(session, access, access.peer_id)
        # Hiding is per member: the owner still sees it, and nothing was deleted.
        assert event.id in await _grid(session, access, access.member_id)
        assert (await _listing(session, access, access.peer_id, team.id)).is_hidden

        await operations.set_visibility(access.peer_id, access.org_id, team.id, False)
        assert event.id in await _grid(session, access, access.peer_id)

    async def test_an_invitation_follows_the_default_calendar(self, session, access) -> None:
        """peer cannot list member's private calendar, so the invitation filed on it
        shows with peer's own default calendar and hides with it."""
        private = await ensure_default_calendar(session, access.org_id, access.member_id)
        mine = await ensure_default_calendar(session, access.org_id, access.peer_id)
        invitation = await _event(session, access, private.id, title="interview")
        session.add(EventAttendee(event_id=invitation.id, user_id=access.peer_id))
        await session.commit()
        operations = _operations(session)

        assert invitation.id in await _grid(session, access, access.peer_id)
        await operations.set_visibility(access.peer_id, access.org_id, mine.id, True)
        assert invitation.id not in await _grid(session, access, access.peer_id)

    async def test_an_organization_calendar_is_opt_in(self, session, access) -> None:
        operations = _operations(session)
        holidays = await operations.create_calendar(
            user_id=access.owner_id,
            organization_id=access.org_id,
            name="Holidays",
            color="#f59e0b",
            access_mode=AccessMode.OPEN_TO_ORG,
            baseline_role=ContentRole.VIEWER,
        )
        event = await _event(session, access, holidays.id, organizer_id=access.owner_id)

        assert event.id not in await _grid(session, access, access.peer_id)
        await operations.set_visibility(access.peer_id, access.org_id, holidays.id, False)
        assert event.id in await _grid(session, access, access.peer_id)

    async def test_hiding_needs_view_access(self, session, access) -> None:
        private = await ensure_default_calendar(session, access.org_id, access.member_id)

        with pytest.raises(PermissionDeniedError):
            await _operations(session).set_visibility(
                access.peer_id, access.org_id, private.id, True
            )


class TestUpdate:
    async def test_viewers_cannot_rename_and_editors_can(self, session, access) -> None:
        operations = _operations(session)
        calendar = await operations.create_calendar(
            user_id=access.member_id,
            organization_id=access.org_id,
            name="Launch",
            color="#3b82f6",
            access_mode=AccessMode.EXPLICIT_MEMBERS,
        )
        calendar_id = calendar.id
        members = ContentMembersOperations(session, AsyncMock(spec=SearchIndexer))
        await members.add_member(
            actor_user_id=access.member_id,
            organization_id=access.org_id,
            content_type=ContentType.CALENDAR,
            content_id=calendar_id,
            subject_type=SubjectType.USER,
            subject_id=access.peer_id,
            role=ContentRole.VIEWER,
        )

        with pytest.raises(PermissionDeniedError):
            await operations.update_calendar(
                access.peer_id, access.org_id, calendar_id, name="Renamed"
            )
        await session.rollback()

        await members.update_member_role(
            actor_user_id=access.member_id,
            organization_id=access.org_id,
            content_type=ContentType.CALENDAR,
            content_id=calendar_id,
            subject_type=SubjectType.USER,
            subject_id=access.peer_id,
            new_role=ContentRole.EDITOR,
        )
        # A checker caches decisions for one request; the promotion is the next request.
        updated = await _operations(session).update_calendar(
            access.peer_id, access.org_id, calendar_id, name="Launch week", color="#ec4899"
        )
        assert (updated.name, updated.color) == ("Launch week", "#ec4899")


class TestDelete:
    async def test_moving_keeps_series_attendees_and_overrides(self, session, access) -> None:
        operations = _operations(session)
        source = await operations.create_calendar(
            user_id=access.member_id,
            organization_id=access.org_id,
            name="Old team",
            color="#3b82f6",
        )
        target = await ensure_default_calendar(session, access.org_id, access.member_id)
        master = CalendarEvent(
            organization_id=access.org_id,
            organizer_id=access.member_id,
            calendar_id=source.id,
            title="standup",
            start_time=START,
            end_time=START + timedelta(minutes=15),
            access_mode=AccessMode.OWNER_ONLY,
            recurrence_pattern=RecurrencePattern.DAILY,
        )
        session.add(master)
        await session.flush()
        override = CalendarEvent(
            organization_id=access.org_id,
            organizer_id=access.member_id,
            calendar_id=source.id,
            recurrence_id=master.id,
            title="standup (moved)",
            start_time=START + timedelta(days=1, hours=2),
            end_time=START + timedelta(days=1, hours=2, minutes=15),
            access_mode=AccessMode.OWNER_ONLY,
        )
        session.add_all([override, EventAttendee(event_id=master.id, user_id=access.peer_id)])
        await session.commit()
        master_id, override_id, source_id = master.id, override.id, source.id

        result = await operations.delete_calendar(
            access.member_id, access.org_id, source_id, target_calendar_id=target.id
        )

        assert (result.events_moved, result.events_deleted) == (2, 0)
        rows = (
            await session.execute(
                select(CalendarEvent.id, CalendarEvent.calendar_id, CalendarEvent.is_deleted).where(
                    CalendarEvent.id.in_([master_id, override_id])
                )
            )
        ).all()
        assert {(row.calendar_id, row.is_deleted) for row in rows} == {(target.id, False)}
        assert (
            await session.scalar(
                select(EventAttendee.user_id).where(EventAttendee.event_id == master_id)
            )
            == access.peer_id
        )
        assert await session.scalar(select(Calendar.is_deleted).where(Calendar.id == source_id))

    async def test_moving_needs_edit_on_the_target(self, session, access) -> None:
        operations = _operations(session)
        source = await operations.create_calendar(
            user_id=access.member_id,
            organization_id=access.org_id,
            name="Source",
            color="#3b82f6",
        )
        colleague = await ensure_default_calendar(session, access.org_id, access.peer_id)
        source_id = source.id

        # A calendar the actor cannot see is indistinguishable from one that does not exist.
        with pytest.raises(NotFoundError):
            await operations.delete_calendar(
                access.member_id, access.org_id, source_id, target_calendar_id=colleague.id
            )
        await session.rollback()
        assert not await session.scalar(select(Calendar.is_deleted).where(Calendar.id == source_id))

    async def test_deleting_removes_every_event(self, session, access) -> None:
        operations = _operations(session)
        source = await operations.create_calendar(
            user_id=access.member_id,
            organization_id=access.org_id,
            name="Retired",
            color="#3b82f6",
        )
        events = [await _event(session, access, source.id) for _ in range(3)]
        event_ids = [event.id for event in events]

        result = await operations.delete_calendar(
            access.member_id, access.org_id, source.id, target_calendar_id=None
        )

        assert (result.events_moved, result.events_deleted) == (0, 3)
        deleted = (
            await session.execute(
                select(CalendarEvent.is_deleted).where(CalendarEvent.id.in_(event_ids))
            )
        ).scalars()
        assert all(deleted)

    async def test_deleting_cancels_the_event_for_its_attendees(self, session, access) -> None:
        operations = _operations(session)
        source = await operations.create_calendar(
            user_id=access.member_id,
            organization_id=access.org_id,
            name="Offsite",
            color="#3b82f6",
        )
        event = await _event(session, access, source.id)
        session.add(EventAttendee(event_id=event.id, user_id=access.peer_id))
        await session.commit()
        event_id = event.id

        try:
            await operations.delete_calendar(
                access.member_id, access.org_id, source.id, target_calendar_id=None
            )

            rows = (
                await session.execute(
                    select(NotificationEmailDelivery).where(
                        NotificationEmailDelivery.content_id == event_id
                    )
                )
            ).scalars()
            staged = {(row.user_id, read_event_mail(row).kind) for row in rows}
            assert staged == {(access.peer_id, CalendarMailKind.CANCELLATION)}
        finally:
            await session.execute(
                delete(NotificationEmailDelivery).where(
                    NotificationEmailDelivery.content_id == event_id
                )
            )
            await session.commit()

    async def test_too_many_series_refuse_the_delete_and_change_nothing(
        self, session, access, monkeypatch
    ) -> None:
        monkeypatch.setattr(calendar_operations, "MAX_DELETED_SERIES", 2)
        operations = _operations(session)
        source = await operations.create_calendar(
            user_id=access.member_id,
            organization_id=access.org_id,
            name="Archive",
            color="#3b82f6",
        )
        event_ids = [(await _event(session, access, source.id)).id for _ in range(3)]
        source_id = source.id

        with pytest.raises(ValidationError):
            await operations.delete_calendar(
                access.member_id, access.org_id, source_id, target_calendar_id=None
            )
        await session.rollback()

        deleted = (
            await session.execute(
                select(CalendarEvent.is_deleted).where(CalendarEvent.id.in_(event_ids))
            )
        ).scalars()
        assert not any(deleted)
        assert not await session.scalar(select(Calendar.is_deleted).where(Calendar.id == source_id))

    async def test_the_default_calendar_is_not_deletable(self, session, access) -> None:
        default = await ensure_default_calendar(session, access.org_id, access.member_id)

        with pytest.raises(ValidationError):
            await _operations(session).delete_calendar(
                access.member_id, access.org_id, default.id, target_calendar_id=None
            )

    async def test_a_viewer_cannot_delete(self, session, access) -> None:
        operations = _operations(session)
        calendar = await operations.create_calendar(
            user_id=access.member_id,
            organization_id=access.org_id,
            name="Shared",
            color="#3b82f6",
            access_mode=AccessMode.OPEN_TO_ORG,
            baseline_role=ContentRole.VIEWER,
        )
        calendar_id = calendar.id

        with pytest.raises(PermissionDeniedError):
            await operations.delete_calendar(
                access.peer_id, access.org_id, calendar_id, target_calendar_id=None
            )
        await session.rollback()
        assert not await session.scalar(
            select(Calendar.is_deleted).where(Calendar.id == calendar_id)
        )

    async def test_a_blocked_series_stops_the_delete_before_anything_changes(
        self, session, access
    ) -> None:
        operations = _operations(session)
        calendar = await operations.create_calendar(
            user_id=access.member_id,
            organization_id=access.org_id,
            name="Mixed",
            color="#3b82f6",
        )
        calendar_id = calendar.id
        mine = await _event(session, access, calendar_id)
        theirs = await _event(session, access, calendar_id, organizer_id=access.peer_id)
        session.add(
            ContentMember(
                organization_id=access.org_id,
                content_type=ContentType.CALENDAR_EVENT,
                content_id=theirs.id,
                subject_type=SubjectType.USER,
                subject_id=access.member_id,
                role=ContentRole.BLOCKED,
                added_by_user_id=access.peer_id,
            )
        )
        await session.commit()
        event_ids = [mine.id, theirs.id]

        with pytest.raises(PermissionDeniedError):
            await operations.delete_calendar(
                access.member_id, access.org_id, calendar_id, target_calendar_id=None
            )
        await session.rollback()
        assert not await session.scalar(
            select(Calendar.is_deleted).where(Calendar.id == calendar_id)
        )
        deleted = (
            await session.execute(
                select(CalendarEvent.is_deleted).where(CalendarEvent.id.in_(event_ids))
            )
        ).scalars()
        assert not any(deleted)

    async def test_moving_frees_an_imported_uid_held_by_a_deleted_copy(
        self, session, access
    ) -> None:
        operations = _operations(session)
        source = await operations.create_calendar(
            user_id=access.member_id,
            organization_id=access.org_id,
            name="Imported",
            color="#3b82f6",
        )
        target = await ensure_default_calendar(session, access.org_id, access.member_id)
        uid = f"uid-{generate_id().hex}"
        stale = await _event(session, access, source.id)
        stale.ical_uid, stale.is_deleted = uid, True
        live = await _event(session, access, target.id)
        live.ical_uid = uid
        await session.commit()
        stale_id, live_id = stale.id, live.id

        await operations.delete_calendar(
            access.member_id, access.org_id, source.id, target_calendar_id=target.id
        )

        rows = dict(
            (
                await session.execute(
                    select(CalendarEvent.id, CalendarEvent.ical_uid).where(
                        CalendarEvent.id.in_([stale_id, live_id])
                    )
                )
            ).all()
        )
        assert rows == {stale_id: None, live_id: uid}

    async def test_two_live_copies_of_one_import_refuse_the_move(self, session, access) -> None:
        operations = _operations(session)
        source = await operations.create_calendar(
            user_id=access.member_id,
            organization_id=access.org_id,
            name="Duplicate",
            color="#3b82f6",
        )
        source_id = source.id
        target = await ensure_default_calendar(session, access.org_id, access.member_id)
        uid = f"uid-{generate_id().hex}"
        for calendar_id in (source_id, target.id):
            event = await _event(session, access, calendar_id)
            event.ical_uid = uid
        await session.commit()

        with pytest.raises(ValidationError):
            await operations.delete_calendar(
                access.member_id, access.org_id, source_id, target_calendar_id=target.id
            )
        await session.rollback()
        assert not await session.scalar(select(Calendar.is_deleted).where(Calendar.id == source_id))


class TestDeactivatedOwner:
    async def test_a_co_admin_keeps_managing_the_team_calendar(self, session, access) -> None:
        operations = _operations(session)
        calendar = await operations.create_calendar(
            user_id=access.member_id,
            organization_id=access.org_id,
            name="On-call",
            color="#f97316",
            calendar_type=CalendarType.TEAM,
            admin_user_ids=[access.peer_id],
        )
        event = await _event(session, access, calendar.id)
        calendar_id, event_id = calendar.id, event.id
        membership = await session.scalar(
            select(OrganizationMember).where(
                OrganizationMember.user_id == access.member_id,
                OrganizationMember.organization_id == access.org_id,
            )
        )
        membership.is_active = False
        await session.commit()

        renamed = await operations.update_calendar(
            access.peer_id, access.org_id, calendar_id, name="On-call rota"
        )
        assert renamed.name == "On-call rota"
        await ContentMembersOperations(session, AsyncMock()).add_member(
            actor_user_id=access.peer_id,
            organization_id=access.org_id,
            content_type=ContentType.CALENDAR,
            content_id=calendar_id,
            subject_type=SubjectType.USER,
            subject_id=access.admin_id,
            role=ContentRole.VIEWER,
        )
        assert await _listing(session, access, access.admin_id, calendar_id) is not None
        assert event_id in await _grid(session, access, access.peer_id)

        target = await ensure_default_calendar(session, access.org_id, access.peer_id)
        result = await operations.delete_calendar(
            access.peer_id, access.org_id, calendar_id, target_calendar_id=target.id
        )

        assert (result.events_moved, result.events_deleted) == (1, 0)
        assert (
            await session.scalar(
                select(CalendarEvent.calendar_id).where(CalendarEvent.id == event_id)
            )
            == target.id
        )
