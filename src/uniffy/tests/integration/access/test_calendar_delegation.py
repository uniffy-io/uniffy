"""Calendar delegation reaches the grantor's calendar on every read path, and nothing else.

``member`` is the grantor and ``peer`` the delegate throughout. Every assertion is on the rows
and roles a real query returns.
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import select, update

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.permissions.visible_sets import compute_visible_content_ids_by_type
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.events.realtime import ContentAccessAction
from uniffy.core.models.audit.event import AuditEvent, AuditResourceType
from uniffy.core.models.calendar.activity import EventActivity
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.delegation import CalendarDelegationLevel
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.notes.note import Note
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.shared import AttendeeRole, AttendeeStatus
from uniffy.core.search import SearchIndexer
from uniffy.core.types import (
    AccessMode,
    CalendarType,
    ContentRole,
    ContentType,
    EventVisibility,
    SubjectType,
    generate_id,
)
from uniffy.domains.comments.access import CommentTargetAccess
from uniffy.domains.permissions.access import ResourceAccessResolver, ResourceKey
from uniffy.domains.permissions.members import ContentMembersOperations
from uniffy.domains.scheduling.calendar import policy as calendar_policy
from uniffy.domains.scheduling.calendar.calendars.access import (
    calendar_role,
    require_calendar_edit,
)
from uniffy.domains.scheduling.calendar.calendars.operations import CalendarOperations
from uniffy.domains.scheduling.calendar.calendars.reader import CalendarReader, CalendarSection
from uniffy.domains.scheduling.calendar.calendars.search import calendar_search_access
from uniffy.domains.scheduling.calendar.delegation.access import private_detail_stand_ins
from uniffy.domains.scheduling.calendar.delegation.operations import (
    MAX_DELEGATES_PER_GRANTOR,
    CalendarDelegationOperations,
)
from uniffy.domains.scheduling.calendar.events.state import event_details_hidden
from uniffy.domains.scheduling.calendar.ical.ingest import apply_import
from uniffy.domains.scheduling.calendar.operations import (
    CalendarEventOperations,
    CalendarEventReader,
)
from uniffy.domains.scheduling.calendar.queries import ensure_default_calendar

pytestmark = pytest.mark.asyncio(loop_scope="session")

START = datetime.now(UTC).replace(microsecond=0) + timedelta(days=3)

EVENTS = CalendarDelegationLevel.EVENTS
FULL = CalendarDelegationLevel.EVENTS_AND_PRIVATE


def _indexer() -> SearchIndexer:
    return AsyncMock(spec=SearchIndexer)


async def _grant(session, access, level=EVENTS, *, grantor=None, delegate=None):
    return await CalendarDelegationOperations(session).grant(
        grantor or access.member_id, access.org_id, delegate or access.peer_id, level
    )


async def _grantor_calendar(session, access) -> Calendar:
    return await ensure_default_calendar(session, access.org_id, access.member_id)


async def _event(session, access, calendar_id, *, private=False, organizer=None) -> CalendarEvent:
    event = CalendarEvent(
        organization_id=access.org_id,
        organizer_id=organizer or access.member_id,
        calendar_id=calendar_id,
        title=f"1:1-{generate_id().hex[:8]}",
        start_time=START,
        end_time=START + timedelta(hours=1),
        access_mode=AccessMode.OWNER_ONLY,
        visibility=EventVisibility.PRIVATE if private else EventVisibility.STANDARD,
    )
    session.add(event)
    await session.commit()
    return event


async def _invite(session, event, user_id) -> None:
    session.add(EventAttendee(event_id=event.id, user_id=user_id, status=AttendeeStatus.PENDING))
    await session.commit()


async def _role(session, access, user_id, event) -> ContentRole | None:
    return await CalendarEventReader(session)._resolve_role(user_id, access.org_id, event)


async def _batch_role(session, access, user_id, event_id) -> ContentRole | None:
    key = ResourceKey(ContentType.CALENDAR_EVENT, event_id)
    decisions = await ResourceAccessResolver(session).resolve_page(
        actor_id=user_id, organization_id=access.org_id, keys=[key]
    )
    return decisions[key].role if decisions[key].can_view else None


async def _in_range(session, access, user_id) -> set:
    events = await CalendarEventReader(session).get_events_in_range(
        user_id, access.org_id, START - timedelta(days=1), START + timedelta(days=1)
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


async def _visible_ids(session, access, user_id) -> set:
    return await compute_visible_content_ids_by_type(
        session,
        user_id=user_id,
        organization_id=access.org_id,
        content_type=ContentType.CALENDAR_EVENT,
    )


async def _reaches(session, access, user_id, event) -> bool:
    """Every read path agrees, or the test fails on the one that does not."""
    paths = {
        "scalar": await _role(session, access, user_id, event) is not None,
        "batch": await _batch_role(session, access, user_id, event.id) is not None,
        "range": event.id in await _in_range(session, access, user_id),
        "page": event.id in await _in_page(session, access, user_id),
        "tags": event.id in await _visible_ids(session, access, user_id),
    }
    assert len(set(paths.values())) == 1, paths
    return paths["scalar"]


async def _set_active(session, access, user_id, active: bool) -> None:
    await session.execute(
        update(OrganizationMember)
        .where(
            OrganizationMember.user_id == user_id,
            OrganizationMember.organization_id == access.org_id,
        )
        .values(is_active=active)
    )
    await session.commit()


class TestDelegateReach:
    async def test_a_delegate_edits_the_grantors_events_on_every_path(self, session, access):
        calendar = await _grantor_calendar(session, access)
        event = await _event(session, access, calendar.id)
        assert not await _reaches(session, access, access.peer_id, event)

        await _grant(session, access)

        assert await _reaches(session, access, access.peer_id, event)
        assert await _role(session, access, access.peer_id, event) is ContentRole.EDITOR
        assert await _batch_role(session, access, access.peer_id, event.id) is ContentRole.EDITOR
        checker = PermissionChecker(session)
        assert (
            await calendar_role(session, checker, access.peer_id, access.org_id, calendar.id)
            is ContentRole.EDITOR
        )
        listings = await CalendarReader(session).list_calendars(access.peer_id, access.org_id)
        delegated = [listing for listing in listings if listing.calendar.id == calendar.id]
        assert delegated and delegated[0].section is CalendarSection.DELEGATED
        assert delegated[0].delegation_level is EVENTS
        assert (
            access.peer_id
            in (await calendar_search_access(session, access.org_id, calendar.id)).user_ids
        )

        # Nobody else gains anything, the org admin included.
        for stranger in (access.admin_id, access.owner_id, access.ghost_id, access.outsider_id):
            assert not await _reaches(session, access, stranger, event)

    async def test_private_events_stay_busy_until_the_full_level(self, session, access):
        calendar = await _grantor_calendar(session, access)
        private = await _event(session, access, calendar.id, private=True)
        await _grant(session, access, EVENTS)

        role = await _role(session, access, access.peer_id, private)
        assert role is ContentRole.VIEWER
        assert await _batch_role(session, access, access.peer_id, private.id) is ContentRole.VIEWER
        assert event_details_hidden(private, access.peer_id, role, is_attendee=False)

        await _grant(session, access, FULL)

        role = await _role(session, access, access.peer_id, private)
        assert role is ContentRole.EDITOR
        assert await _batch_role(session, access, access.peer_id, private.id) is ContentRole.EDITOR
        assert not event_details_hidden(private, access.peer_id, role, is_attendee=False)

    async def test_an_invited_delegate_reads_a_private_event_at_either_level(self, session, access):
        calendar = await _grantor_calendar(session, access)
        private = await _event(session, access, calendar.id, private=True)
        await _invite(session, private, access.peer_id)
        await _grant(session, access, EVENTS)

        assert await _role(session, access, access.peer_id, private) is ContentRole.EDITOR
        assert await _batch_role(session, access, access.peer_id, private.id) is ContentRole.EDITOR

    async def test_a_blocked_calendar_grant_beats_the_delegation(self, session, access):
        calendar = await _grantor_calendar(session, access)
        event = await _event(session, access, calendar.id)
        await _grant(session, access)
        assert await _reaches(session, access, access.peer_id, event)

        session.add(
            ContentMember(
                organization_id=access.org_id,
                content_type=ContentType.CALENDAR,
                content_id=calendar.id,
                subject_type=SubjectType.USER,
                subject_id=access.peer_id,
                role=ContentRole.BLOCKED,
                added_by_user_id=access.member_id,
            )
        )
        await session.commit()

        assert not await _reaches(session, access, access.peer_id, event)
        checker = PermissionChecker(session)
        assert (
            await calendar_role(session, checker, access.peer_id, access.org_id, calendar.id) is None
        )

    async def test_what_the_grantor_organizes_elsewhere_is_not_delegated(self, session, access):
        team = Calendar(
            organization_id=access.org_id,
            owner_id=access.admin_id,
            name=f"Team-{generate_id().hex[:8]}",
            calendar_type=CalendarType.TEAM,
            access_mode=AccessMode.OWNER_ONLY,
        )
        session.add(team)
        await session.commit()
        event = await _event(session, access, team.id)
        session.add(
            EventAttendee(
                event_id=event.id,
                user_id=access.member_id,
                role=AttendeeRole.ORGANIZER,
                status=AttendeeStatus.ACCEPTED,
            )
        )
        await session.commit()
        await _grant(session, access)

        assert not await _reaches(session, access, access.peer_id, event)

    async def test_a_busy_private_event_keeps_its_side_surfaces_closed(self, session, access):
        calendar = await _grantor_calendar(session, access)
        private = await _event(session, access, calendar.id, private=True)
        await _grant(session, access)
        key = ResourceKey(ContentType.CALENDAR_EVENT, private.id)

        decision = (
            await ResourceAccessResolver(session).resolve_page(
                actor_id=access.peer_id, organization_id=access.org_id, keys=[key]
            )
        )[key]
        assert decision.can_view and decision.details_hidden
        with pytest.raises(PermissionDeniedError):
            await CommentTargetAccess(session).require_view(
                access.peer_id, access.org_id, ContentType.CALENDAR_EVENT, private.id
            )

        await _grant(session, access, FULL)
        await CommentTargetAccess(session).require_view(
            access.peer_id, access.org_id, ContentType.CALENDAR_EVENT, private.id
        )

    async def test_team_calendars_are_not_delegated(self, session, access):
        team = Calendar(
            organization_id=access.org_id,
            owner_id=access.member_id,
            name=f"Team-{generate_id().hex[:8]}",
            calendar_type=CalendarType.TEAM,
            access_mode=AccessMode.EXPLICIT_MEMBERS,
        )
        session.add(team)
        await session.commit()
        event = await _event(session, access, team.id)
        await _grant(session, access)

        assert not await _reaches(session, access, access.peer_id, event)
        with pytest.raises(NotFoundError):
            await require_calendar_edit(session, access.peer_id, access.org_id, team.id)

    async def test_delegation_reaches_nothing_outside_the_calendar(self, session, access):
        await _grant(session, access, FULL)
        note = await session.get(Note, access.private_note_id)
        role = await PermissionChecker(session).effective_role(
            user_id=access.peer_id,
            organization_id=access.org_id,
            content_type=ContentType.NOTE,
            content_id=note.id,
            owner_id=note.owner_id,
            access_mode=note.access_mode,
            baseline_role=note.baseline_role,
        )
        assert role is None
        calendar = await _grantor_calendar(session, access)
        # The calendar's own sharing role is untouched: a delegate cannot rename or reshare it.
        assert (
            await PermissionChecker(session).effective_role(
                user_id=access.peer_id,
                organization_id=access.org_id,
                content_type=ContentType.CALENDAR,
                content_id=calendar.id,
                owner_id=calendar.owner_id,
                access_mode=calendar.access_mode,
                baseline_role=calendar.baseline_role,
            )
            is None
        )

    async def test_delegation_does_not_cross_organizations(self, session, access):
        calendar = await _grantor_calendar(session, access)
        event = await _event(session, access, calendar.id)
        await _grant(session, access)
        events = await CalendarEventReader(session).get_events_in_range(
            access.peer_id,
            access.other_org_id,
            START - timedelta(days=1),
            START + timedelta(days=1),
        )
        assert event.id not in {row.id for row in events}


class TestDelegatedActions:
    async def test_a_delegate_books_in_the_grantors_name(self, buffer, session, access):
        calendar = await _grantor_calendar(session, access)
        await _grant(session, access)

        created = await CalendarEventOperations(session, _indexer(), buffer).create(
            user_id=access.peer_id,
            organization_id=access.org_id,
            title="Board prep",
            start_time=START,
            end_time=START + timedelta(hours=1),
            calendar_id=calendar.id,
            attendee_ids=[access.admin_id],
        )

        assert created.organizer_id == access.member_id
        assert created.arranged_by_id == access.peer_id
        assert await _role(session, access, access.member_id, created) is ContentRole.OWNER
        roles = {
            row.user_id: row.role
            for row in (
                await session.execute(
                    select(EventAttendee).where(EventAttendee.event_id == created.id)
                )
            ).scalars()
        }
        assert roles == {
            access.member_id: AttendeeRole.ORGANIZER,
            access.admin_id: AttendeeRole.REQUIRED,
        }
        activity = (
            await session.execute(select(EventActivity).where(EventActivity.event_id == created.id))
        ).scalar_one()
        assert activity.actor_id == access.peer_id
        assert activity.on_behalf_of_id == access.member_id

    async def test_a_delegate_keeps_the_private_event_they_booked(self, buffer, session, access):
        calendar = await _grantor_calendar(session, access)
        await _grant(session, access)

        created = await CalendarEventOperations(session, _indexer(), buffer).create(
            user_id=access.peer_id,
            organization_id=access.org_id,
            title="Doctor",
            start_time=START,
            end_time=START + timedelta(hours=1),
            calendar_id=calendar.id,
            visibility=EventVisibility.PRIVATE,
        )

        assert await _role(session, access, access.peer_id, created) is ContentRole.EDITOR
        assert await _batch_role(session, access, access.peer_id, created.id) is ContentRole.EDITOR
        assert not event_details_hidden(created, access.peer_id, ContentRole.VIEWER, False)

    async def test_a_delegates_own_answer_is_not_on_anyones_behalf(self, buffer, session, access):
        calendar = await _grantor_calendar(session, access)
        meeting = await _event(session, access, calendar.id)
        await _invite(session, meeting, access.peer_id)
        await _grant(session, access)

        await CalendarEventOperations(session, _indexer(), buffer).update_attendee_status(
            user_id=access.peer_id,
            organization_id=access.org_id,
            event_id=meeting.id,
            status=AttendeeStatus.ACCEPTED,
        )

        activity = (
            await session.execute(
                select(EventActivity).where(
                    EventActivity.event_id == meeting.id,
                    EventActivity.action == "response_changed",
                )
            )
        ).scalar_one()
        assert activity.actor_id == access.peer_id
        assert activity.on_behalf_of_id is None

    async def test_a_delegate_imports_in_the_grantors_name(self, session, access):
        calendar = await _grantor_calendar(session, access)
        await _grant(session, access)
        stamp = START.strftime("%Y%m%dT%H%M%SZ")
        until = (START + timedelta(hours=1)).strftime("%Y%m%dT%H%M%SZ")
        payload = (
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n"
            f"BEGIN:VEVENT\r\nUID:{generate_id().hex}@test\r\nDTSTAMP:{stamp}\r\n"
            f"DTSTART:{stamp}\r\nDTEND:{until}\r\nSUMMARY:Imported\r\nEND:VEVENT\r\n"
            "END:VCALENDAR\r\n"
        ).encode()

        outcome = await apply_import(
            session,
            user_id=access.peer_id,
            organization_id=access.org_id,
            calendar_id=calendar.id,
            payload=payload,
        )

        imported = (
            await session.execute(
                select(CalendarEvent).where(CalendarEvent.id.in_(outcome.created_ids))
            )
        ).scalar_one()
        assert imported.organizer_id == access.member_id
        assert imported.arranged_by_id == access.peer_id

    async def test_the_grantors_open_calendar_hears_what_a_delegate_did(
        self, buffer, session, access, monkeypatch
    ):
        published = AsyncMock()
        monkeypatch.setattr(
            "uniffy.domains.scheduling.calendar.events.content.publish_content_access_changed",
            published,
        )
        calendar = await _grantor_calendar(session, access)
        await _grant(session, access)
        ops = CalendarEventOperations(session, _indexer(), buffer)

        booked = await ops.create(
            user_id=access.peer_id,
            organization_id=access.org_id,
            title="Quarterly sync",
            start_time=START,
            end_time=START + timedelta(hours=1),
            calendar_id=calendar.id,
        )
        organizer_calendar = await ensure_default_calendar(session, access.org_id, access.admin_id)
        meeting = await _event(session, access, organizer_calendar.id, organizer=access.admin_id)
        await _invite(session, meeting, access.member_id)
        await ops.update_attendee_status(
            user_id=access.peer_id,
            organization_id=access.org_id,
            event_id=meeting.id,
            status=AttendeeStatus.ACCEPTED,
            on_behalf_of=access.member_id,
        )

        acted = [
            (call.kwargs["content_id"], call.kwargs["target_user_ids"])
            for call in published.await_args_list
            if call.kwargs["action"] == ContentAccessAction.ACTED_ON_BEHALF
        ]
        assert acted == [(booked.id, [access.member_id]), (meeting.id, [access.member_id])]

    async def test_booking_on_an_own_calendar_stays_in_the_actors_name(
        self, buffer, session, access
    ):
        own = await ensure_default_calendar(session, access.org_id, access.peer_id)
        await _grant(session, access)
        created = await CalendarEventOperations(session, _indexer(), buffer).create(
            user_id=access.peer_id,
            organization_id=access.org_id,
            title="My own",
            start_time=START,
            end_time=START + timedelta(hours=1),
            calendar_id=own.id,
        )
        assert created.organizer_id == access.peer_id
        assert created.arranged_by_id is None

    async def test_a_delegate_edits_and_cancels_but_cannot_delete_or_reshare(
        self, buffer, session, access
    ):
        calendar = await _grantor_calendar(session, access)
        event = await _event(session, access, calendar.id)
        await _grant(session, access)
        operations = CalendarEventOperations(session, _indexer(), buffer)

        await operations.update(
            user_id=access.peer_id,
            organization_id=access.org_id,
            event_id=event.id,
            title="Renamed by the delegate",
            call_lifecycle=MagicMock(),
        )
        activity = (
            (
                await session.execute(
                    select(EventActivity).where(
                        EventActivity.event_id == event.id, EventActivity.actor_id == access.peer_id
                    )
                )
            )
            .scalars()
            .first()
        )
        assert activity is not None and activity.on_behalf_of_id == access.member_id

        with pytest.raises(PermissionDeniedError):
            await operations.delete(access.peer_id, access.org_id, event.id)
        with pytest.raises(PermissionDeniedError):
            await ContentMembersOperations(session, _indexer()).add_member(
                actor_user_id=access.peer_id,
                organization_id=access.org_id,
                content_type=ContentType.CALENDAR_EVENT,
                content_id=event.id,
                subject_type=SubjectType.USER,
                subject_id=access.admin_id,
                role=ContentRole.VIEWER,
            )
        with pytest.raises((NotFoundError, PermissionDeniedError)):
            await CalendarOperations(session, _indexer()).update_calendar(
                access.peer_id, access.org_id, calendar.id, name="Hijacked"
            )

    async def test_a_delegate_answers_an_invitation_for_the_grantor(self, buffer, session, access):
        organizer_calendar = await ensure_default_calendar(session, access.org_id, access.admin_id)
        meeting = await _event(session, access, organizer_calendar.id, organizer=access.admin_id)
        await _invite(session, meeting, access.member_id)
        assert not await _reaches(session, access, access.peer_id, meeting)

        await _grant(session, access)

        # The grantor's invitation shows on the delegate's view, read-only.
        assert await _reaches(session, access, access.peer_id, meeting)
        assert await _role(session, access, access.peer_id, meeting) is ContentRole.VIEWER

        await CalendarEventOperations(session, _indexer(), buffer).update_attendee_status(
            user_id=access.peer_id,
            organization_id=access.org_id,
            event_id=meeting.id,
            status=AttendeeStatus.ACCEPTED,
            on_behalf_of=access.member_id,
        )
        row = (
            await session.execute(
                select(EventAttendee).where(
                    EventAttendee.event_id == meeting.id,
                    EventAttendee.user_id == access.member_id,
                )
            )
        ).scalar_one()
        await session.refresh(row)
        assert row.status is AttendeeStatus.ACCEPTED
        assert row.responded_by_id == access.peer_id
        activity = (
            await session.execute(
                select(EventActivity).where(
                    EventActivity.event_id == meeting.id,
                    EventActivity.action == "response_changed",
                )
            )
        ).scalar_one()
        assert activity.actor_id == access.peer_id
        assert activity.on_behalf_of_id == access.member_id

    async def test_answering_for_someone_without_a_delegation_is_refused(
        self, buffer, session, access
    ):
        organizer_calendar = await ensure_default_calendar(session, access.org_id, access.admin_id)
        meeting = await _event(session, access, organizer_calendar.id, organizer=access.admin_id)
        await _invite(session, meeting, access.member_id)

        with pytest.raises(PermissionDeniedError):
            await CalendarEventOperations(session, _indexer(), buffer).update_attendee_status(
                user_id=access.peer_id,
                organization_id=access.org_id,
                event_id=meeting.id,
                status=AttendeeStatus.DECLINED,
                on_behalf_of=access.member_id,
            )

    async def test_full_level_reveals_private_details_wherever_the_grantor_attends(
        self, session, access
    ):
        await _grant(session, access, EVENTS)
        assert await private_detail_stand_ins(session, access.peer_id, access.org_id) == {
            access.peer_id
        }
        await _grant(session, access, FULL)
        assert await private_detail_stand_ins(session, access.peer_id, access.org_id) == {
            access.peer_id,
            access.member_id,
        }


class TestEndingADelegation:
    async def test_revoking_ends_every_path_at_once(self, session, access):
        calendar = await _grantor_calendar(session, access)
        event = await _event(session, access, calendar.id)
        view = await _grant(session, access)
        assert await _reaches(session, access, access.peer_id, event)

        await CalendarDelegationOperations(session).revoke(
            access.member_id, access.org_id, view.delegation.id
        )

        assert not await _reaches(session, access, access.peer_id, event)
        with pytest.raises(NotFoundError):
            await require_calendar_edit(session, access.peer_id, access.org_id, calendar.id)
        assert (
            access.peer_id
            not in (await calendar_search_access(session, access.org_id, calendar.id)).user_ids
        )

    async def test_the_delegate_may_step_down_and_strangers_may_not_revoke(self, session, access):
        view = await _grant(session, access)
        with pytest.raises(NotFoundError):
            await CalendarDelegationOperations(session).revoke(
                access.admin_id, access.org_id, view.delegation.id
            )
        await CalendarDelegationOperations(session).revoke(
            access.peer_id, access.org_id, view.delegation.id
        )
        by_me, to_me = await CalendarDelegationOperations(session).list_mine(
            access.peer_id, access.org_id
        )
        assert by_me == [] and to_me == []

    @pytest.mark.parametrize("deactivated", ["member_id", "peer_id"])
    async def test_deactivating_either_party_ends_access_until_reactivation(
        self, session, access, deactivated
    ):
        calendar = await _grantor_calendar(session, access)
        event = await _event(session, access, calendar.id)
        await _grant(session, access)

        await _set_active(session, access, getattr(access, deactivated), False)
        assert not await _reaches(session, access, access.peer_id, event)
        if deactivated == "member_id":
            # The delegate still sees the grant, marked as conferring nothing.
            _, to_me = await CalendarDelegationOperations(session).list_mine(
                access.peer_id, access.org_id
            )
            assert to_me and to_me[0].inactive

        await _set_active(session, access, getattr(access, deactivated), True)
        assert await _reaches(session, access, access.peer_id, event)


class TestGrantRules:
    async def test_self_and_inactive_delegates_are_refused(self, session, access):
        with pytest.raises(ValidationError):
            await _grant(session, access, delegate=access.member_id)
        with pytest.raises(ValidationError):
            await _grant(session, access, delegate=access.ghost_id)
        with pytest.raises(ValidationError):
            await _grant(session, access, delegate=access.outsider_id)

    async def test_the_admins_policy_refuses_members_but_keeps_existing_grants(
        self, session, access
    ):
        calendar = await _grantor_calendar(session, access)
        event = await _event(session, access, calendar.id)
        await _grant(session, access, FULL)
        await calendar_policy.update_calendar_policy(
            session,
            access.admin_id,
            access.org_id,
            team_calendar_creators=calendar_policy.CalendarPolicyAudience.EVERYONE,
            org_wide_calendar_sharers=calendar_policy.CalendarPolicyAudience.EVERYONE,
            delegators=calendar_policy.CalendarPolicyAudience.ADMINS,
        )

        with pytest.raises(PermissionDeniedError):
            await _grant(session, access, delegate=access.admin_id)
        # Narrowing a grant stays the member's call; raising it again is new reach.
        assert (await _grant(session, access, EVENTS)).delegation.level is EVENTS
        with pytest.raises(PermissionDeniedError):
            await _grant(session, access, FULL)
        # The grant made before the policy changed keeps working until revoked.
        assert await _reaches(session, access, access.peer_id, event)
        # Admins are inside the ADMINS audience.
        await _grant(session, access, grantor=access.admin_id, delegate=access.peer_id)
        view = await calendar_policy.get_calendar_policy_view(
            session, access.member_id, access.org_id
        )
        assert not view.can_delegate

    async def test_a_grantor_has_a_stated_ceiling(self, session, access, monkeypatch):
        monkeypatch.setattr(
            "uniffy.domains.scheduling.calendar.delegation.operations.MAX_DELEGATES_PER_GRANTOR", 1
        )
        await _grant(session, access)
        with pytest.raises(ValidationError):
            await _grant(session, access, delegate=access.admin_id)
        assert MAX_DELEGATES_PER_GRANTOR == 50

    async def test_grant_change_and_revoke_are_audited(self, session, access):
        view = await _grant(session, access)
        await _grant(session, access, FULL)
        await CalendarDelegationOperations(session).revoke(
            access.member_id, access.org_id, view.delegation.id
        )
        rows = (
            (
                await session.execute(
                    select(AuditEvent)
                    .where(
                        AuditEvent.organization_id == access.org_id,
                        AuditEvent.resource_type == AuditResourceType.CALENDAR_DELEGATION,
                    )
                    .order_by(AuditEvent.created_at)
                )
            )
            .scalars()
            .all()
        )
        assert [row.action for row in rows] == [
            "calendar.delegation_granted",
            "calendar.delegation_updated",
            "calendar.delegation_revoked",
        ]
        assert rows[1].details["previous_level"] == "EVENTS"
        assert rows[2].details["by"] == "grantor"
        assert all(row.actor_user_id == access.member_id for row in rows)
