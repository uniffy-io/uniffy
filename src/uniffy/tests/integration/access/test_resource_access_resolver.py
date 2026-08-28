from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, event

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.chat.agent_folder import ChatAgentFolder
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.chat.message import ChatMessage
from uniffy.core.models.login.user import User
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.permissions.domain_admin import DomainAdmin
from uniffy.core.models.platform.support_session import (
    SupportSession,
    SupportSessionScope,
    SupportSessionState,
)
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.sprint import Sprint as _Sprint  # noqa: F401 - FK metadata
from uniffy.core.models.projects.task import Task
from uniffy.core.models.tags.tag import Tag, TagAssignment
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
    DomainType,
    SubjectType,
    generate_id,
)
from uniffy.domains.notes.operations import NoteOperations
from uniffy.domains.permissions.access import (
    ResourceAccessPurpose,
    ResourceAccessResolver,
    ResourceKey,
    ResourceRowState,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _resolve(session, access, user_id, keys):
    return await ResourceAccessResolver(session).resolve(
        actor_id=user_id,
        organization_id=access.org_id,
        keys=keys,
        purpose=ResourceAccessPurpose.SEARCH,
    )


async def test_standard_policy_matrix_uses_postgres_rows(session, access) -> None:
    keys = [
        ResourceKey(ContentType.NOTE, content_id)
        for content_id in (
            access.private_note_id,
            access.shared_note_id,
            access.org_note_id,
            access.blocked_note_id,
            access.group_note_id,
        )
    ]

    peer = await _resolve(session, access, access.peer_id, keys)

    assert peer[keys[0]].can_view is False
    assert peer[keys[1]].role is ContentRole.VIEWER
    assert peer[keys[2]].role is ContentRole.VIEWER
    assert peer[keys[3]].can_view is False
    assert peer[keys[4]].role is ContentRole.EDITOR


async def test_admin_has_no_private_content_bypass(session, access) -> None:
    key = ResourceKey(ContentType.NOTE, access.private_note_id)

    decisions = await _resolve(session, access, access.admin_id, [key])

    assert decisions[key].row_state is ResourceRowState.LIVE
    assert decisions[key].can_view is False


async def test_inactive_member_cannot_read_owned_or_open_content(session, access) -> None:
    keys = [
        ResourceKey(ContentType.NOTE, access.org_note_id),
        ResourceKey(ContentType.NOTE, access.private_note_id),
    ]

    decisions = await _resolve(session, access, access.ghost_id, keys)

    assert all(not decision.can_view for decision in decisions.values())


async def test_blocked_wins_over_ownership_and_expired_grants_are_ignored(session, access) -> None:
    session.add_all([
        ContentMember(
            organization_id=access.org_id,
            content_type=ContentType.NOTE,
            content_id=access.admin_note_id,
            subject_type=SubjectType.USER,
            subject_id=access.admin_id,
            role=ContentRole.BLOCKED,
            added_by_user_id=access.owner_id,
        ),
        ContentMember(
            organization_id=access.org_id,
            content_type=ContentType.NOTE,
            content_id=access.private_note_id,
            subject_type=SubjectType.USER,
            subject_id=access.peer_id,
            role=ContentRole.VIEWER,
            expires_at=datetime.now(UTC) - timedelta(seconds=1),
            added_by_user_id=access.owner_id,
        ),
    ])
    await session.commit()
    owner_key = ResourceKey(ContentType.NOTE, access.admin_note_id)
    expired_key = ResourceKey(ContentType.NOTE, access.private_note_id)

    owner = await _resolve(session, access, access.admin_id, [owner_key])
    expired = await _resolve(session, access, access.peer_id, [expired_key])

    assert owner[owner_key].can_view is False
    assert expired[expired_key].can_view is False


async def test_search_sharing_snapshot_omits_expired_allow_and_blocked_rows(
    session,
    access,
) -> None:
    expired_at = datetime.now(UTC) - timedelta(seconds=1)
    session.add_all([
        ContentMember(
            organization_id=access.org_id,
            content_type=ContentType.NOTE,
            content_id=access.private_note_id,
            subject_type=SubjectType.USER,
            subject_id=access.peer_id,
            role=ContentRole.VIEWER,
            expires_at=expired_at,
            added_by_user_id=access.owner_id,
        ),
        ContentMember(
            organization_id=access.org_id,
            content_type=ContentType.NOTE,
            content_id=access.private_note_id,
            subject_type=SubjectType.USER,
            subject_id=access.admin_id,
            role=ContentRole.BLOCKED,
            expires_at=expired_at,
            added_by_user_id=access.owner_id,
        ),
        ContentMember(
            organization_id=access.org_id,
            content_type=ContentType.NOTE,
            content_id=access.private_note_id,
            subject_type=SubjectType.USER,
            subject_id=access.owner_id,
            role=ContentRole.VIEWER,
            added_by_user_id=access.owner_id,
        ),
    ])
    await session.commit()

    shared_users, shared_groups, blocked_users, blocked_groups = await NoteOperations(
        session
    )._get_member_id_lists(
        access.org_id,
        access.private_note_id,
    )

    assert shared_users == [access.owner_id]
    assert shared_groups == []
    assert blocked_users == []
    assert blocked_groups == []


async def test_tasks_inherit_live_project_access_and_request_target(session, access) -> None:
    project = Project(
        organization_id=access.org_id,
        owner_id=access.member_id,
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.VIEWER,
        name="Resolver project",
        slug=f"ra-{generate_id().hex[:8]}",
    )
    session.add(project)
    await session.flush()
    task = Task(
        organization_id=access.org_id,
        project_id=project.id,
        owner_id=access.member_id,
        title="Resolver task",
    )
    session.add(task)
    await session.commit()
    key = ResourceKey(ContentType.TASK, task.id)

    decisions = await _resolve(session, access, access.peer_id, [key])

    assert decisions[key].can_view is True
    assert decisions[key].request_target is not None
    assert decisions[key].request_target.content_type is ContentType.PROJECT
    assert decisions[key].request_target.content_id == project.id
    assert decisions[key].target_policy is not None
    assert decisions[key].target_policy.content_type is ContentType.PROJECT
    assert decisions[key].target_policy.access_mode is AccessMode.OPEN_TO_ORG


async def test_chat_messages_inherit_current_channel_membership(session, access) -> None:
    channel = ChatChannel(
        organization_id=access.org_id,
        owner_id=access.member_id,
        name="Resolver private",
        slug=f"resolver-private-{generate_id().hex[:8]}",
        channel_type=ChannelType.PRIVATE,
    )
    session.add(channel)
    await session.flush()
    message = ChatMessage(channel_id=channel.id, sender_id=access.member_id, content="Secret")
    session.add(message)
    await session.commit()
    key = ResourceKey(ContentType.CHAT_MESSAGE, message.id)

    denied = await _resolve(session, access, access.peer_id, [key])
    session.add(
        ChatChannelMember(
            channel_id=channel.id,
            subject_type=SubjectType.USER,
            subject_id=access.peer_id,
            user_id=access.peer_id,
        )
    )
    await session.commit()
    allowed = await _resolve(session, access, access.peer_id, [key])

    assert denied[key].can_view is False
    assert denied[key].request_target is not None
    assert denied[key].request_target.content_id == channel.id
    assert allowed[key].can_view is True

    await session.execute(delete(ChatMessage).where(ChatMessage.id == message.id))
    await session.commit()


async def test_chat_policy_keeps_org_and_domain_moderation_access(session, access) -> None:
    channel = ChatChannel(
        organization_id=access.org_id,
        owner_id=access.member_id,
        name="Resolver moderated private",
        slug=f"resolver-moderated-{generate_id().hex[:8]}",
        channel_type=ChannelType.PRIVATE,
    )
    session.add(channel)
    await session.commit()
    key = ResourceKey(ContentType.CHAT, channel.id)

    admin = await _resolve(session, access, access.admin_id, [key])
    denied = await _resolve(session, access, access.peer_id, [key])
    session.add(
        DomainAdmin(
            organization_id=access.org_id,
            user_id=access.peer_id,
            domain=DomainType.CHAT,
            granted_by=access.owner_id,
        )
    )
    await session.commit()
    domain_admin = await _resolve(session, access, access.peer_id, [key])

    assert admin[key].can_view is True
    assert denied[key].can_view is False
    assert domain_admin[key].can_view is True


async def test_calendar_override_inherits_master_policy(session, access) -> None:
    now = datetime.now(UTC)
    calendar = Calendar(
        organization_id=access.org_id,
        owner_id=access.member_id,
        name="Resolver recurrence calendar",
    )
    session.add(calendar)
    await session.flush()
    master = CalendarEvent(
        organization_id=access.org_id,
        organizer_id=access.member_id,
        calendar_id=calendar.id,
        title="Private series",
        start_time=now,
        end_time=now + timedelta(hours=1),
        access_mode=AccessMode.OWNER_ONLY,
    )
    session.add(master)
    await session.flush()
    override = CalendarEvent(
        organization_id=access.org_id,
        organizer_id=access.peer_id,
        calendar_id=calendar.id,
        recurrence_id=master.id,
        title="Misleading open override",
        start_time=now + timedelta(days=1),
        end_time=now + timedelta(days=1, hours=1),
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.EDITOR,
    )
    session.add(override)
    await session.commit()
    key = ResourceKey(ContentType.CALENDAR_EVENT, override.id)

    peer = await _resolve(session, access, access.peer_id, [key])
    owner = await _resolve(session, access, access.member_id, [key])

    assert peer[key].can_view is False
    assert owner[key].role is ContentRole.OWNER
    assert owner[key].target_policy is not None
    assert owner[key].target_policy.access_mode is AccessMode.OWNER_ONLY


async def test_calendar_attendee_access_yields_to_explicit_block(session, access) -> None:
    now = datetime.now(UTC)
    calendar = Calendar(
        organization_id=access.org_id,
        owner_id=access.member_id,
        name="Resolver calendar",
    )
    session.add(calendar)
    await session.flush()
    event_row = CalendarEvent(
        organization_id=access.org_id,
        organizer_id=access.member_id,
        calendar_id=calendar.id,
        title="Resolver event",
        start_time=now,
        end_time=now + timedelta(hours=1),
        access_mode=AccessMode.OWNER_ONLY,
    )
    session.add(event_row)
    await session.flush()
    session.add(EventAttendee(event_id=event_row.id, user_id=access.peer_id))
    await session.commit()
    key = ResourceKey(ContentType.CALENDAR_EVENT, event_row.id)

    attendee = await _resolve(session, access, access.peer_id, [key])
    session.add(
        ContentMember(
            organization_id=access.org_id,
            content_type=ContentType.CALENDAR_EVENT,
            content_id=event_row.id,
            subject_type=SubjectType.USER,
            subject_id=access.peer_id,
            role=ContentRole.BLOCKED,
            added_by_user_id=access.member_id,
        )
    )
    await session.commit()
    blocked = await _resolve(session, access, access.peer_id, [key])

    assert attendee[key].role is ContentRole.VIEWER
    assert blocked[key].can_view is False


async def test_calendar_attendee_floor_does_not_demote_higher_roles(session, access) -> None:
    """The attendee floor lifts denied viewers only; resolving an organizer's own
    event in the same batch as an attendee-floor event must keep OWNER."""
    now = datetime.now(UTC)
    calendar = Calendar(
        organization_id=access.org_id,
        owner_id=access.peer_id,
        name="Floor calendar",
    )
    session.add(calendar)
    await session.flush()
    own_event = CalendarEvent(
        organization_id=access.org_id,
        organizer_id=access.peer_id,
        calendar_id=calendar.id,
        title="Own event",
        start_time=now,
        end_time=now + timedelta(hours=1),
        access_mode=AccessMode.OWNER_ONLY,
    )
    invited_event = CalendarEvent(
        organization_id=access.org_id,
        organizer_id=access.member_id,
        calendar_id=calendar.id,
        title="Invited event",
        start_time=now,
        end_time=now + timedelta(hours=1),
        access_mode=AccessMode.OWNER_ONLY,
    )
    session.add_all([own_event, invited_event])
    await session.flush()
    session.add_all([
        EventAttendee(event_id=own_event.id, user_id=access.peer_id),
        EventAttendee(event_id=invited_event.id, user_id=access.peer_id),
    ])
    await session.commit()
    own_key = ResourceKey(ContentType.CALENDAR_EVENT, own_event.id)
    invited_key = ResourceKey(ContentType.CALENDAR_EVENT, invited_event.id)

    decisions = await _resolve(session, access, access.peer_id, [own_key, invited_key])

    assert decisions[own_key].role is ContentRole.OWNER
    assert decisions[invited_key].role is ContentRole.VIEWER


async def test_directory_and_agent_folder_policies(session, access) -> None:
    own_folder = ChatAgentFolder(
        organization_id=access.org_id,
        user_id=access.peer_id,
        name=f"Own {generate_id().hex[:8]}",
    )
    other_folder = ChatAgentFolder(
        organization_id=access.org_id,
        user_id=access.member_id,
        name=f"Other {generate_id().hex[:8]}",
    )
    session.add_all([own_folder, other_folder])
    await session.commit()
    keys = [
        ResourceKey(ContentType.USER, access.member_id),
        ResourceKey(ContentType.TEAM, access.team_id),
        ResourceKey(ContentType.AGENT_FOLDER, own_folder.id),
        ResourceKey(ContentType.AGENT_FOLDER, other_folder.id),
    ]

    decisions = await _resolve(session, access, access.peer_id, keys)

    assert decisions[keys[0]].role is ContentRole.VIEWER
    assert decisions[keys[1]].role is ContentRole.VIEWER
    assert decisions[keys[2]].role is ContentRole.OWNER
    assert decisions[keys[3]].row_state is ResourceRowState.MISSING


async def test_tag_visibility_is_candidate_bounded_and_postgres_authorized(
    session,
    access,
) -> None:
    suffix = generate_id().hex[:8]
    visible_tag = Tag(
        organization_id=access.org_id,
        name=f"Visible {suffix}",
        slug=f"visible-{suffix}",
        created_by=access.member_id,
    )
    hidden_tag = Tag(
        organization_id=access.org_id,
        name=f"Hidden {suffix}",
        slug=f"hidden-{suffix}",
        created_by=access.member_id,
    )
    session.add_all([visible_tag, hidden_tag])
    await session.flush()
    session.add_all([
        TagAssignment(
            tag_id=visible_tag.id,
            content_urn=f"urn:uniffy:content:NOTE:{access.shared_note_id}",
            content_type=ContentType.NOTE.value,
            sources=["manual"],
            assigned_by=access.member_id,
        ),
        TagAssignment(
            tag_id=hidden_tag.id,
            content_urn=f"urn:uniffy:content:NOTE:{access.private_note_id}",
            content_type=ContentType.NOTE.value,
            sources=["manual"],
            assigned_by=access.member_id,
        ),
    ])
    await session.commit()
    visible_key = ResourceKey(ContentType.TAG, visible_tag.id)
    hidden_key = ResourceKey(ContentType.TAG, hidden_tag.id)

    decisions = await _resolve(session, access, access.peer_id, [visible_key, hidden_key])

    assert decisions[visible_key].can_view is True
    assert decisions[hidden_key].can_view is False


async def test_support_session_is_required_live_and_time_bound(session, access) -> None:
    suffix = generate_id().hex[:10]
    support_user = User(
        email=f"support-{suffix}@test.local",
        username=f"support-{suffix}",
        full_name="Support Operator",
        hashed_password="x",
        is_system_admin=True,
    )
    session.add(support_user)
    await session.commit()
    access.user_ids.append(support_user.id)
    key = ResourceKey(ContentType.NOTE, access.private_note_id)

    denied = await _resolve(session, access, support_user.id, [key])
    now = datetime.now(UTC)
    support_session = SupportSession(
        organization_id=access.org_id,
        support_user_id=support_user.id,
        requested_by_user_id=support_user.id,
        granted_by_user_id=access.owner_id,
        reason="Resolver integration test",
        scope=SupportSessionScope.READ_ONLY,
        state=SupportSessionState.ACTIVE,
        requested_at=now,
        granted_at=now,
        expires_at=now + timedelta(minutes=5),
    )
    session.add(support_session)
    await session.commit()
    allowed = await _resolve(session, access, support_user.id, [key])
    support_session.expires_at = now - timedelta(seconds=1)
    session.add(support_session)
    await session.commit()
    expired = await _resolve(session, access, support_user.id, [key])

    assert denied[key].can_view is False
    assert allowed[key].role is ContentRole.VIEWER
    assert expired[key].can_view is False


async def test_missing_and_cross_org_rows_are_not_live(session, access) -> None:
    missing = ResourceKey(ContentType.NOTE, access.other_org_id)

    decisions = await _resolve(session, access, access.peer_id, [missing])

    assert decisions[missing].row_state is ResourceRowState.MISSING
    assert decisions[missing].can_view is False


async def test_statement_count_does_not_grow_with_candidate_count(session, access) -> None:
    all_keys = [
        ResourceKey(ContentType.NOTE, content_id)
        for content_id in (
            access.private_note_id,
            access.shared_note_id,
            access.org_note_id,
            access.blocked_note_id,
            access.admin_note_id,
            access.group_note_id,
        )
    ]
    all_keys.extend(ResourceKey(ContentType.NOTE, generate_id()) for _ in range(60 - len(all_keys)))
    engine = session.bind.sync_engine

    async def statement_count(keys):
        count = 0

        def before_cursor_execute(*_args):
            nonlocal count
            count += 1

        event.listen(engine, "before_cursor_execute", before_cursor_execute)
        try:
            await _resolve(session, access, access.peer_id, keys)
        finally:
            event.remove(engine, "before_cursor_execute", before_cursor_execute)
        return count

    assert len(all_keys) == 60
    assert await statement_count(all_keys[:1]) == await statement_count(all_keys)


async def test_scalar_role_uses_one_postgres_statement_after_domain_load(session, access) -> None:
    count = 0
    engine = session.bind.sync_engine

    def before_cursor_execute(*_args):
        nonlocal count
        count += 1

    event.listen(engine, "before_cursor_execute", before_cursor_execute)
    try:
        role = await PermissionChecker(session).effective_role(
            user_id=access.member_id,
            organization_id=access.org_id,
            content_type=ContentType.NOTE,
            content_id=access.private_note_id,
            owner_id=access.member_id,
            access_mode=AccessMode.OWNER_ONLY,
            baseline_role=None,
        )
    finally:
        event.remove(engine, "before_cursor_execute", before_cursor_execute)

    assert role is ContentRole.OWNER
    assert count == 1
