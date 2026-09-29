"""A calendar grant reaches the events filed on that calendar, on every read path.

Event access used to be decided from the event alone, so these walk the same
actors through the point check, both list queries, the batch resolver, the
notification audience and tag visibility, and assert on the rows each returns.
"""

import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import delete, func, select

from uniffy.core.auth.permissions.visible_sets import compute_visible_content_ids_by_type
from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.permissions.org_permission_defaults import (
    OrganizationPermissionDefaults,
)
from uniffy.core.search import SearchIndexer
from uniffy.core.types import (
    AccessMode,
    CalendarType,
    ContentRole,
    ContentType,
    EventVisibility,
    RecurrencePattern,
    SubjectType,
    generate_id,
)
from uniffy.domains.permissions.access import ResourceAccessResolver, ResourceKey
from uniffy.domains.permissions.access.audience import ResourceAudienceResolver
from uniffy.domains.permissions.access.types import ResourceAccessPurpose
from uniffy.domains.permissions.members import ContentMembersOperations
from uniffy.domains.scheduling.calendar.calendars.reader import CalendarReader
from uniffy.domains.scheduling.calendar.events.state import event_details_hidden
from uniffy.domains.scheduling.calendar.operations import (
    CalendarEventOperations,
    CalendarEventReader,
)
from uniffy.domains.scheduling.calendar.queries import ensure_default_calendar
from uniffy.infrastructure.database import open_session

pytestmark = pytest.mark.asyncio(loop_scope="session")

START = datetime.now(UTC).replace(microsecond=0) + timedelta(days=2)


def _indexer() -> SearchIndexer:
    return AsyncMock(spec=SearchIndexer)


async def _calendar(session, access, *, name="Team") -> Calendar:
    calendar = Calendar(
        organization_id=access.org_id,
        owner_id=access.member_id,
        name=f"{name}-{generate_id().hex[:8]}",
        calendar_type=CalendarType.TEAM,
        access_mode=AccessMode.EXPLICIT_MEMBERS,
    )
    session.add(calendar)
    await session.commit()
    return calendar


async def _event(session, access, calendar_id, *, private=False) -> CalendarEvent:
    event = CalendarEvent(
        organization_id=access.org_id,
        organizer_id=access.member_id,
        calendar_id=calendar_id,
        title=f"standup-{generate_id().hex[:8]}",
        start_time=START,
        end_time=START + timedelta(hours=1),
        access_mode=AccessMode.OWNER_ONLY,
        visibility=EventVisibility.PRIVATE if private else EventVisibility.STANDARD,
    )
    session.add(event)
    await session.commit()
    return event


async def _share(session, access, calendar_id, subject_type, subject_id, role) -> None:
    await ContentMembersOperations(session, _indexer()).add_member(
        actor_user_id=access.member_id,
        organization_id=access.org_id,
        content_type=ContentType.CALENDAR,
        content_id=calendar_id,
        subject_type=subject_type,
        subject_id=subject_id,
        role=role,
    )


async def _role(session, access, user_id, event) -> ContentRole | None:
    return await CalendarEventReader(session)._resolve_role(user_id, access.org_id, event)


async def _in_range(session, access, user_id) -> set:
    events = await CalendarEventReader(session).get_events_in_range(
        user_id,
        access.org_id,
        START - timedelta(days=1),
        START + timedelta(days=1),
    )
    return {event.id for event in events}


async def _in_page(session, access, user_id) -> set:
    page = await CalendarEventReader(session).list_events_page(
        user_id,
        access.org_id,
        start_date=START - timedelta(days=1),
        end_date=START + timedelta(days=1),
    )
    return {event.id for event in page.events}


async def _decision(session, access, user_id, event_id):
    key = ResourceKey(ContentType.CALENDAR_EVENT, event_id)
    decisions = await ResourceAccessResolver(session).resolve(
        actor_id=user_id,
        organization_id=access.org_id,
        keys=[key],
        purpose=ResourceAccessPurpose.SEARCH,
    )
    return decisions[key]


async def _audience(session, access, event_id) -> set:
    return set(
        await ResourceAudienceResolver(session).filter_resource(
            organization_id=access.org_id,
            key=ResourceKey(ContentType.CALENDAR_EVENT, event_id),
            candidate_user_ids=[
                access.owner_id,
                access.admin_id,
                access.member_id,
                access.peer_id,
                access.ghost_id,
                access.outsider_id,
            ],
        )
    )


async def _block_on_event(session, access, event_id, user_id) -> None:
    session.add(
        ContentMember(
            organization_id=access.org_id,
            content_type=ContentType.CALENDAR_EVENT,
            content_id=event_id,
            subject_type=SubjectType.USER,
            subject_id=user_id,
            role=ContentRole.BLOCKED,
            added_by_user_id=access.member_id,
        )
    )
    await session.commit()


class TestGroupViewerOnATeamCalendar:
    """peer reaches the calendar through the access group; nobody else was granted it."""

    async def test_every_read_path_admits_the_viewer_and_nobody_else(self, session, access) -> None:
        calendar = await _calendar(session, access)
        await _share(
            session,
            access,
            calendar.id,
            SubjectType.GROUP,
            access.access_group_id,
            ContentRole.VIEWER,
        )
        event = await _event(session, access, calendar.id)

        assert await _role(session, access, access.peer_id, event) is ContentRole.VIEWER
        assert event.id in await _in_range(session, access, access.peer_id)
        assert event.id in await _in_page(session, access, access.peer_id)
        decision = await _decision(session, access, access.peer_id, event.id)
        assert decision.can_view and decision.role is ContentRole.VIEWER
        assert await _audience(session, access, event.id) == {access.member_id, access.peer_id}
        assert event.id in await compute_visible_content_ids_by_type(
            session,
            user_id=access.peer_id,
            organization_id=access.org_id,
            content_type=ContentType.CALENDAR_EVENT,
        )

        # The org admin holds no grant and gets no bypass; the deactivated and
        # foreign members reach nothing either.
        for stranger in (access.admin_id, access.ghost_id, access.outsider_id):
            assert await _role(session, access, stranger, event) is None
            assert event.id not in await _in_range(session, access, stranger)
            assert event.id not in await _in_page(session, access, stranger)
            assert not (await _decision(session, access, stranger, event.id)).can_view
        assert event.id not in await compute_visible_content_ids_by_type(
            session,
            user_id=access.admin_id,
            organization_id=access.org_id,
            content_type=ContentType.CALENDAR_EVENT,
        )

    async def test_a_viewer_cannot_edit(self, session, access) -> None:
        calendar = await _calendar(session, access)
        await _share(
            session, access, calendar.id, SubjectType.USER, access.peer_id, ContentRole.VIEWER
        )
        event = await _event(session, access, calendar.id)
        event_id, title = event.id, event.title

        with pytest.raises(PermissionDeniedError):
            await CalendarEventOperations(session, _indexer()).update(
                user_id=access.peer_id,
                organization_id=access.org_id,
                event_id=event_id,
                title="renamed by a viewer",
                call_lifecycle=MagicMock(),
            )
        await session.rollback()

        assert (
            await session.scalar(select(CalendarEvent.title).where(CalendarEvent.id == event_id))
            == title
        )

    async def test_a_calendar_editor_edits_events_others_organized(self, session, access) -> None:
        calendar = await _calendar(session, access)
        await _share(
            session, access, calendar.id, SubjectType.USER, access.peer_id, ContentRole.EDITOR
        )
        event = await _event(session, access, calendar.id)

        assert await _role(session, access, access.peer_id, event) is ContentRole.EDITOR
        updated = await CalendarEventOperations(session, _indexer()).update(
            user_id=access.peer_id,
            organization_id=access.org_id,
            event_id=event.id,
            title="moved to Thursday",
            call_lifecycle=MagicMock(),
        )

        assert updated.title == "moved to Thursday"
        assert updated.organizer_id == access.member_id

    async def test_owning_the_calendar_confers_admin_not_organizer(self, session, access) -> None:
        calendar = Calendar(
            organization_id=access.org_id,
            owner_id=access.peer_id,
            name=f"peer-{generate_id().hex[:8]}",
            access_mode=AccessMode.OWNER_ONLY,
        )
        session.add(calendar)
        await session.commit()
        event = await _event(session, access, calendar.id)

        assert await _role(session, access, access.peer_id, event) is ContentRole.ADMIN
        assert await _role(session, access, access.member_id, event) is ContentRole.OWNER

    async def test_private_details_stay_hidden_from_viewers_only(self, session, access) -> None:
        calendar = await _calendar(session, access)
        await _share(
            session, access, calendar.id, SubjectType.USER, access.peer_id, ContentRole.VIEWER
        )
        event = await _event(session, access, calendar.id, private=True)

        viewer_role = await _role(session, access, access.peer_id, event)
        assert event_details_hidden(event, access.peer_id, viewer_role, False)

        await ContentMembersOperations(session, _indexer()).update_member_role(
            actor_user_id=access.member_id,
            organization_id=access.org_id,
            content_type=ContentType.CALENDAR,
            content_id=calendar.id,
            subject_type=SubjectType.USER,
            subject_id=access.peer_id,
            new_role=ContentRole.EDITOR,
        )
        editor_role = await _role(session, access, access.peer_id, event)
        assert not event_details_hidden(event, access.peer_id, editor_role, False)


class TestBlockedPrecedence:
    async def test_an_event_block_beats_the_calendar_grant(self, session, access) -> None:
        calendar = await _calendar(session, access)
        await _share(
            session, access, calendar.id, SubjectType.USER, access.peer_id, ContentRole.EDITOR
        )
        event = await _event(session, access, calendar.id)
        await _block_on_event(session, access, event.id, access.peer_id)

        assert await _role(session, access, access.peer_id, event) is None
        assert event.id not in await _in_range(session, access, access.peer_id)
        assert event.id not in await _in_page(session, access, access.peer_id)
        assert not (await _decision(session, access, access.peer_id, event.id)).can_view
        assert access.peer_id not in await _audience(session, access, event.id)

    async def test_a_series_block_hides_its_edited_occurrences(self, session, access) -> None:
        """The block sits on the master; the edited occurrence row has its own id
        and a copied open policy, and neither may carry it back in."""
        calendar = await _calendar(session, access)
        await _share(
            session, access, calendar.id, SubjectType.USER, access.peer_id, ContentRole.EDITOR
        )
        master = await _event(session, access, calendar.id)
        master.recurrence_pattern = RecurrencePattern.WEEKLY
        edited = CalendarEvent(
            organization_id=access.org_id,
            organizer_id=access.member_id,
            calendar_id=calendar.id,
            recurrence_id=master.id,
            title="edited occurrence",
            start_time=START + timedelta(hours=2),
            end_time=START + timedelta(hours=3),
            access_mode=AccessMode.OPEN_TO_ORG,
            baseline_role=ContentRole.VIEWER,
        )
        session.add(edited)
        await session.commit()
        await _block_on_event(session, access, master.id, access.peer_id)

        in_range = await _in_range(session, access, access.peer_id)
        in_page = await _in_page(session, access, access.peer_id)
        assert master.id not in in_range and edited.id not in in_range
        assert master.id not in in_page and edited.id not in in_page

    async def test_a_calendar_block_leaves_the_invitation(self, session, access) -> None:
        calendar = await _calendar(session, access)
        await _share(
            session, access, calendar.id, SubjectType.USER, access.peer_id, ContentRole.BLOCKED
        )
        event = await _event(session, access, calendar.id)
        session.add(EventAttendee(event_id=event.id, user_id=access.peer_id))
        await session.commit()

        assert await _role(session, access, access.peer_id, event) is ContentRole.VIEWER
        assert event.id in await _in_range(session, access, access.peer_id)
        assert (await _decision(session, access, access.peer_id, event.id)).can_view


class TestGroupMembershipChurn:
    async def test_inactive_group_rows_and_members_confer_nothing(self, session, access) -> None:
        """The team group holds an active member, a deactivated member, and an
        inactive membership row for peer; only the active member gets through."""
        calendar = Calendar(
            organization_id=access.org_id,
            owner_id=access.owner_id,
            name=f"platform-{generate_id().hex[:8]}",
            access_mode=AccessMode.EXPLICIT_MEMBERS,
        )
        session.add(calendar)
        await session.commit()
        await ContentMembersOperations(session, _indexer()).add_member(
            actor_user_id=access.owner_id,
            organization_id=access.org_id,
            content_type=ContentType.CALENDAR,
            content_id=calendar.id,
            subject_type=SubjectType.GROUP,
            subject_id=access.team_id,
            role=ContentRole.VIEWER,
        )
        event = CalendarEvent(
            organization_id=access.org_id,
            organizer_id=access.owner_id,
            calendar_id=calendar.id,
            title="platform sync",
            start_time=START,
            end_time=START + timedelta(hours=1),
            access_mode=AccessMode.OWNER_ONLY,
        )
        session.add(event)
        await session.commit()

        assert await _role(session, access, access.member_id, event) is ContentRole.VIEWER
        assert await _role(session, access, access.peer_id, event) is None
        assert await _role(session, access, access.ghost_id, event) is None
        assert await _audience(session, access, event.id) == {access.owner_id, access.member_id}


class TestOrganizationDefaultsCannotOpenCalendars:
    async def test_an_open_calendar_default_opens_no_existing_calendar(
        self, session, access
    ) -> None:
        mine = await ensure_default_calendar(session, access.org_id, access.member_id)
        event = await _event(session, access, mine.id)
        session.add(
            OrganizationPermissionDefaults(
                organization_id=access.org_id,
                content_type=ContentType.CALENDAR,
                default_access_mode=AccessMode.OPEN_TO_ORG,
                default_baseline_role=ContentRole.EDITOR,
                updated_by_user_id=access.owner_id,
            )
        )
        await session.commit()
        try:
            assert mine.access_mode is AccessMode.OWNER_ONLY
            assert await _role(session, access, access.peer_id, event) is None
            assert event.id not in await _in_range(session, access, access.peer_id)
        finally:
            await session.execute(
                delete(OrganizationPermissionDefaults).where(
                    OrganizationPermissionDefaults.organization_id == access.org_id
                )
            )
            await session.commit()


class TestInheritedBaseline:
    async def test_an_open_calendar_without_a_baseline_reads_as_viewer_everywhere(
        self, session, access
    ) -> None:
        """No org default carries a calendar baseline, so the VIEWER floor applies on
        the list path exactly as on the point check."""
        calendar = await _calendar(session, access)
        calendar.access_mode = AccessMode.OPEN_TO_ORG
        calendar.baseline_role = None
        await session.commit()
        event = await _event(session, access, calendar.id)

        assert await _role(session, access, access.peer_id, event) == ContentRole.VIEWER
        assert event.id in await _in_range(session, access, access.peer_id)
        listed = await CalendarReader(session).list_calendars(access.peer_id, access.org_id)
        assert calendar.id in {listing.calendar.id for listing in listed}


class TestDefaultCalendar:
    async def test_concurrent_first_requests_share_one_default(self, session, access) -> None:
        async def ensure():
            async with open_session() as own_session:
                return (await ensure_default_calendar(own_session, access.org_id, access.peer_id)).id

        ids = await asyncio.gather(*(ensure() for _ in range(4)))

        assert len(set(ids)) == 1
        assert (
            await session.scalar(
                select(func.count())
                .select_from(Calendar)
                .where(
                    Calendar.organization_id == access.org_id,
                    Calendar.owner_id == access.peer_id,
                    Calendar.is_default == True,  # noqa: E712
                )
            )
            == 1
        )


class TestCalendarAdminsManageEventSharing:
    async def _invite_owner(self, session, access, actor_id, event_id) -> None:
        await ContentMembersOperations(session, _indexer()).add_member(
            actor_user_id=actor_id,
            organization_id=access.org_id,
            content_type=ContentType.CALENDAR_EVENT,
            content_id=event_id,
            subject_type=SubjectType.USER,
            subject_id=access.owner_id,
            role=ContentRole.VIEWER,
        )

    async def _shared_event(self, session, access, role) -> CalendarEvent:
        calendar = await _calendar(session, access)
        await _share(session, access, calendar.id, SubjectType.USER, access.peer_id, role)
        event = await _event(session, access, calendar.id)
        event.access_mode = AccessMode.EXPLICIT_MEMBERS
        await session.commit()
        return event

    async def test_a_calendar_admin_shares_an_event_filed_by_someone_else(
        self, session, access
    ) -> None:
        event = await self._shared_event(session, access, ContentRole.ADMIN)
        event_id = event.id

        await self._invite_owner(session, access, access.peer_id, event_id)

        members = await ContentMembersOperations(session, _indexer()).list_members(
            access.peer_id, access.org_id, ContentType.CALENDAR_EVENT, event_id
        )
        assert access.owner_id in {member.subject_id for member in members}

    async def test_a_calendar_editor_cannot_share_it(self, session, access) -> None:
        event = await self._shared_event(session, access, ContentRole.EDITOR)
        event_id = event.id

        with pytest.raises(PermissionDeniedError):
            await self._invite_owner(session, access, access.peer_id, event_id)

    async def test_an_event_block_beats_the_calendar_admin(self, session, access) -> None:
        event = await self._shared_event(session, access, ContentRole.ADMIN)
        event_id = event.id
        await _block_on_event(session, access, event_id, access.peer_id)

        with pytest.raises(PermissionDeniedError):
            await self._invite_owner(session, access, access.peer_id, event_id)
