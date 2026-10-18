"""Unit tests for attendee-based access to calendar events.

An invitation is an explicit grant: attendees get a VIEWER floor on the event
regardless of its access mode (the accept-from-notification flow fetches the
event right after the RSVP), they stay searchable for the invitee, and an
explicit BLOCKED grant still beats the invitation.
"""

from collections.abc import Iterator
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.errors import PermissionDeniedError
from uniffy.core.events.realtime import ContentAccessAction
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.search.engine import SearchAll, SearchAny, SearchFilter, SearchNot, SearchTerm
from uniffy.core.search.policy import build_permission_filter
from uniffy.core.types import AccessMode, AttendeeStatus, ContentRole, generate_id
from uniffy.domains.scheduling.calendar.operations import CalendarEventOperations


def _make_event() -> CalendarEvent:
    now = datetime.now(UTC)
    return CalendarEvent(
        organization_id=generate_id(),
        organizer_id=generate_id(),
        calendar_id=generate_id(),
        title="1:1 Sync",
        start_time=now,
        end_time=now,
        access_mode=AccessMode.OWNER_ONLY,
    )


def _make_ops(
    *,
    effective_role: ContentRole | None = None,
    is_attendee: bool = False,
    is_blocked: bool = False,
    calendar_role: ContentRole | None = None,
) -> CalendarEventOperations:
    ops = CalendarEventOperations.__new__(CalendarEventOperations)
    ops.session = MagicMock()
    ops.permission_checker = MagicMock()
    ops.permission_checker.effective_role = AsyncMock(return_value=effective_role)
    ops.permission_checker.is_blocked = AsyncMock(return_value=is_blocked)
    ops._is_attendee = AsyncMock(return_value=is_attendee)
    ops._calendar_derived_role = AsyncMock(return_value=calendar_role)
    return ops


def _walk_filter(expression: SearchFilter) -> Iterator[SearchFilter]:
    yield expression
    if isinstance(expression, SearchNot):
        yield from _walk_filter(expression.expression)
    elif isinstance(expression, SearchAll | SearchAny):
        for nested in expression.expressions:
            yield from _walk_filter(nested)


class TestResolveRoleAttendeeFloor:
    async def test_attendee_gets_viewer_on_owner_only_event(self) -> None:
        ops = _make_ops(is_attendee=True)
        role = await ops._resolve_role(generate_id(), generate_id(), _make_event())
        assert role == ContentRole.VIEWER

    async def test_non_attendee_stays_denied(self) -> None:
        ops = _make_ops(is_attendee=False)
        role = await ops._resolve_role(generate_id(), generate_id(), _make_event())
        assert role is None

    async def test_blocked_attendee_stays_denied(self) -> None:
        ops = _make_ops(is_attendee=True, is_blocked=True)
        role = await ops._resolve_role(generate_id(), generate_id(), _make_event())
        assert role is None

    async def test_content_role_wins_over_floor(self) -> None:
        # An explicit EDITOR grant must not be downgraded to the VIEWER floor.
        ops = _make_ops(effective_role=ContentRole.EDITOR, is_attendee=True)
        role = await ops._resolve_role(generate_id(), generate_id(), _make_event())
        assert role == ContentRole.EDITOR
        ops._is_attendee.assert_not_awaited()


class TestResolveRoleThroughCalendar:
    """A calendar grant reaches the events filed on it without replacing the
    event's own grants, and an explicit BLOCKED on the event still wins."""

    async def test_calendar_viewer_sees_an_owner_only_event(self) -> None:
        ops = _make_ops(calendar_role=ContentRole.VIEWER)
        role = await ops._resolve_role(generate_id(), generate_id(), _make_event())
        assert role == ContentRole.VIEWER

    async def test_calendar_editor_outranks_the_invitation(self) -> None:
        ops = _make_ops(calendar_role=ContentRole.EDITOR, is_attendee=True)
        role = await ops._resolve_role(generate_id(), generate_id(), _make_event())
        assert role == ContentRole.EDITOR
        ops._is_attendee.assert_not_awaited()

    async def test_calendar_grant_lifts_a_lower_event_grant(self) -> None:
        ops = _make_ops(effective_role=ContentRole.VIEWER, calendar_role=ContentRole.ADMIN)
        role = await ops._resolve_role(generate_id(), generate_id(), _make_event())
        assert role == ContentRole.ADMIN

    async def test_a_higher_event_grant_is_not_lowered(self) -> None:
        ops = _make_ops(effective_role=ContentRole.EDITOR, calendar_role=ContentRole.VIEWER)
        role = await ops._resolve_role(generate_id(), generate_id(), _make_event())
        assert role == ContentRole.EDITOR

    async def test_the_organizer_needs_no_calendar_lookup(self) -> None:
        ops = _make_ops(effective_role=ContentRole.OWNER, calendar_role=ContentRole.ADMIN)
        role = await ops._resolve_role(generate_id(), generate_id(), _make_event())
        assert role == ContentRole.OWNER
        ops._calendar_derived_role.assert_not_awaited()

    async def test_event_block_beats_the_calendar_grant(self) -> None:
        ops = _make_ops(calendar_role=ContentRole.EDITOR, is_blocked=True)
        role = await ops._resolve_role(generate_id(), generate_id(), _make_event())
        assert role is None


class TestResolveRoleOnExpandedOccurrence:
    """Expanded recurring instances carry a synthetic `{master}__occurrence__{date}`
    id. Feeding that string to the permission lookup makes asyncpg reject the
    query argument, so every lookup resolves to the master UUID first.
    """

    async def test_permission_lookup_uses_master_uuid(self) -> None:
        ops = _make_ops(effective_role=ContentRole.EDITOR)
        event = _make_event()
        master_id = event.id
        event.id = f"{master_id}__occurrence__2026-08-03"  # type: ignore[assignment]

        role = await ops._resolve_role(generate_id(), event.organization_id, event)

        assert role == ContentRole.EDITOR
        assert ops.permission_checker.effective_role.await_args.kwargs["content_id"] == master_id

    async def test_attendee_floor_uses_master_uuid(self) -> None:
        ops = _make_ops(is_attendee=True)
        event = _make_event()
        master_id = event.id
        event.id = f"{master_id}__occurrence__2026-08-03"  # type: ignore[assignment]

        role = await ops._resolve_role(generate_id(), event.organization_id, event)

        assert role == ContentRole.VIEWER
        assert ops._is_attendee.await_args.args[2] == master_id
        assert ops.permission_checker.is_blocked.await_args.args[3] == master_id


class TestGetByIdAfterRsvp:
    """The accept-from-notification flow: RSVP succeeds, then the frontend
    fetches the event. The fetch must pass for an invitee on a personal event.
    """

    async def test_invitee_can_fetch_owner_only_event(self) -> None:
        ops = _make_ops(is_attendee=True)
        event = _make_event()
        ops._fetch_by_id = AsyncMock(return_value=event)
        fetched = await ops.get_by_id(generate_id(), event.organization_id, event.id)
        assert fetched is event

    async def test_stranger_still_denied(self) -> None:
        ops = _make_ops(is_attendee=False)
        event = _make_event()
        ops._fetch_by_id = AsyncMock(return_value=event)
        with pytest.raises(PermissionDeniedError):
            await ops.get_by_id(generate_id(), event.organization_id, event.id)


class TestRsvpMembershipGate:
    """A response rides the read resolver, so a stale attendee row left behind
    by removal authorises nothing on its own."""

    async def test_former_member_cannot_respond(self) -> None:
        ops = _make_ops(is_attendee=False)
        event = _make_event()
        ops._fetch_by_id = AsyncMock(return_value=event)

        with pytest.raises(PermissionDeniedError):
            await ops.update_attendee_status(
                generate_id(), event.organization_id, event.id, AttendeeStatus.ACCEPTED
            )

        ops.session.execute.assert_not_called()

    async def test_active_attendee_still_responds(self) -> None:
        ops = _make_ops(is_attendee=True)
        event = _make_event()
        invitee = generate_id()
        attendee = MagicMock(status=AttendeeStatus.PENDING)
        ops._fetch_by_id = AsyncMock(return_value=event)
        ops.session.execute = AsyncMock(
            return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=attendee))
        )
        ops.session.commit = AsyncMock()
        ops._log_activity = AsyncMock()

        with patch(
            "uniffy.domains.scheduling.calendar.events.attendees.emit_notification",
            AsyncMock(),
        ) as emit:
            assert await ops.update_attendee_status(
                invitee, event.organization_id, event.id, AttendeeStatus.ACCEPTED
            )

        assert attendee.status == AttendeeStatus.ACCEPTED
        assert emit.await_args.args[0].target_user_ids == [event.organizer_id]


class TestSearchAttendeeIds:
    async def test_hook_returns_attendee_ids(self) -> None:
        ops = CalendarEventOperations.__new__(CalendarEventOperations)
        u1, u2 = generate_id(), generate_id()
        ops.session = MagicMock()
        ops.session.execute = AsyncMock(
            return_value=MagicMock(all=MagicMock(return_value=[(u1,), (u2,)]))
        )
        ids = await ops._get_search_attendee_user_ids(_make_event())
        assert ids == [u1, u2]

    async def test_hook_returns_none_when_no_attendees(self) -> None:
        ops = CalendarEventOperations.__new__(CalendarEventOperations)
        ops.session = MagicMock()
        ops.session.execute = AsyncMock(return_value=MagicMock(all=MagicMock(return_value=[])))
        assert await ops._get_search_attendee_user_ids(_make_event()) is None

    async def test_index_for_search_passes_attendees(self) -> None:
        ops = CalendarEventOperations.__new__(CalendarEventOperations)
        ops.session = MagicMock()
        ops.search_indexer = MagicMock()
        ops.search_indexer.index = AsyncMock()
        ops._effective_policy = AsyncMock(return_value=(AccessMode.OWNER_ONLY, None))
        ops._get_search_tags_async = AsyncMock(return_value=None)
        invitee = generate_id()
        ops._get_search_attendee_user_ids = AsyncMock(return_value=[invitee])
        ops._get_search_container_access = AsyncMock(return_value=None)

        await ops._index_for_search(_make_event(), skip_member_lookup=True)

        kwargs = ops.search_indexer.index.await_args.kwargs
        assert kwargs["attendee_user_ids"] == [invitee]

    async def test_refresh_pushes_current_set(self) -> None:
        ops = CalendarEventOperations.__new__(CalendarEventOperations)
        ops.search_indexer = MagicMock()
        ops.search_indexer.update_attendees = AsyncMock()
        invitee = generate_id()
        ops._get_search_attendee_user_ids = AsyncMock(return_value=[invitee])

        event = _make_event()
        await ops._refresh_search_attendees(event)

        kwargs = ops.search_indexer.update_attendees.await_args.kwargs
        assert kwargs["attendee_user_ids"] == [invitee]
        assert kwargs["organization_id"] == event.organization_id

    async def test_refresh_is_best_effort(self) -> None:
        ops = CalendarEventOperations.__new__(CalendarEventOperations)
        ops.search_indexer = MagicMock()
        ops.search_indexer.update_attendees = AsyncMock(side_effect=RuntimeError("meili down"))
        ops._get_search_attendee_user_ids = AsyncMock(return_value=[])
        # A search-side failure must not fail the attendee mutation.
        await ops._refresh_search_attendees(_make_event())


class TestAttendeeAccessFanout:
    async def test_targets_affected_attendees_after_commit(self) -> None:
        ops = CalendarEventOperations.__new__(CalendarEventOperations)
        event = _make_event()
        attendee = generate_id()

        with patch(
            "uniffy.domains.scheduling.calendar.events.content.publish_content_access_changed",
            AsyncMock(),
        ) as publish:
            await ops._publish_attendee_access_change(
                event,
                [attendee, attendee],
                ContentAccessAction.GRANTED,
            )

        assert publish.await_args.kwargs["content_id"] == event.id
        assert publish.await_args.kwargs["organization_id"] == event.organization_id
        assert publish.await_args.kwargs["target_user_ids"] == [attendee]
        assert publish.await_args.kwargs["action"] == ContentAccessAction.GRANTED

    async def test_pubsub_failure_does_not_roll_back_the_mutation(self) -> None:
        ops = CalendarEventOperations.__new__(CalendarEventOperations)

        with patch(
            "uniffy.domains.scheduling.calendar.events.content.publish_content_access_changed",
            AsyncMock(side_effect=RuntimeError("valkey down")),
        ):
            await ops._publish_attendee_access_change(
                _make_event(),
                [generate_id()],
                ContentAccessAction.REVOKED,
            )


class TestSearchCandidateFilter:
    def test_filter_includes_attendee_branch(self) -> None:
        user_id = generate_id()
        expressions = tuple(_walk_filter(build_permission_filter(generate_id(), user_id)))
        assert SearchTerm("attendee_user_ids", str(user_id)) in expressions
        assert SearchNot(SearchTerm("blocked_user_ids", str(user_id))) in expressions

    def test_filter_includes_calendar_branch(self) -> None:
        user_id, group_id = generate_id(), generate_id()
        expressions = tuple(
            _walk_filter(build_permission_filter(generate_id(), user_id, (group_id,)))
        )
        assert SearchTerm("container_user_ids", str(user_id)) in expressions
        assert SearchTerm("container_group_ids", str(group_id)) in expressions
        assert SearchTerm("container_open_to_org", True) in expressions
        # The event's own BLOCKED still excludes a calendar member.
        assert SearchNot(SearchTerm("blocked_user_ids", str(user_id))) in expressions

    def test_my_content_only_narrows_to_owned(self) -> None:
        user_id = generate_id()
        expression = build_permission_filter(generate_id(), user_id, my_content_only=True)
        assert isinstance(expression, SearchAll)
        assert expression.expressions[-1] == SearchTerm("owner_id", str(user_id))
        assert SearchNot(SearchTerm("blocked_user_ids", str(user_id))) in tuple(
            _walk_filter(expression)
        )

    def test_owner_filter_keeps_permission_and_block_clauses(self) -> None:
        user_id = generate_id()
        owner_id = generate_id()
        expression = build_permission_filter(generate_id(), user_id, owner_filter=owner_id)
        assert isinstance(expression, SearchAll)
        assert expression.expressions[-1] == SearchTerm("owner_id", str(owner_id))
        expressions = tuple(_walk_filter(expression))
        assert SearchNot(SearchTerm("blocked_user_ids", str(user_id))) in expressions
        assert SearchTerm("access_mode", "OPEN_TO_ORG") in expressions
