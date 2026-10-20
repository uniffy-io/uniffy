"""A member's one-person conversation: owner-only access and a shape nobody can change."""

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from uniffy_proto.chat.v1.chat_pb import (
    GetChannelRequest,
    GetMessagesRequest,
    SetTypingRequest,
)

from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.channel_member import ChannelRole, ChatChannelMember
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.types import ContentType, SubjectType, generate_id
from uniffy.domains.calls.operations import CallOperations
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.chat.channels import handlers as channel_handlers
from uniffy.domains.chat.channels.converters import channel_to_proto
from uniffy.domains.chat.channels.handlers import ChannelHandlers
from uniffy.domains.chat.channels.operations import ChatChannelOperations
from uniffy.domains.chat.messages import handlers as message_handlers
from uniffy.domains.chat.messages.handlers import MessageHandlers
from uniffy.domains.chat.messages.notifications import MessageNotifications
from uniffy.domains.chat.resources.access import resolve_chat_resources
from uniffy.domains.chat.subjects import ChatSubject
from uniffy.domains.permissions.access.subject import AccessSubject
from uniffy.domains.permissions.access.types import ResourceKey
from uniffy.domains.scheduling.calendar.events.channels import ChannelBindingOperations
from uniffy.domains.tags.targets import TagTargetAccess


def _self_dm(owner_id: UUID | None = None) -> ChatChannel:
    return ChatChannel(
        id=generate_id(),
        organization_id=generate_id(),
        owner_id=owner_id or generate_id(),
        name="Ada Lovelace",
        slug="ada-lovelace-12345678",
        channel_type=ChannelType.DIRECT,
        is_self_dm=True,
    )


def _owner_row(channel: ChatChannel) -> ChatChannelMember:
    return ChatChannelMember(
        channel_id=channel.id,
        subject_type=SubjectType.USER,
        subject_id=channel.owner_id,
        user_id=channel.owner_id,
        role=ChannelRole.OWNER,
    )


def _checker(
    *,
    org_admin: bool = False,
    chat_admin: bool = False,
    membership: ChatChannelMember | None = None,
) -> ChatAccessChecker:
    checker = ChatAccessChecker(MagicMock())
    checker.require_org_member = AsyncMock()
    checker.is_org_admin = AsyncMock(return_value=org_admin)
    checker.is_chat_domain_admin = AsyncMock(return_value=chat_admin)
    checker.get_membership = AsyncMock(return_value=membership)
    return checker


def _operations(channel: ChatChannel, checker: ChatAccessChecker) -> ChatChannelOperations:
    operations = ChatChannelOperations.__new__(ChatChannelOperations)
    operations.session = MagicMock()
    operations.session.execute = AsyncMock()
    operations.session.commit = AsyncMock()
    operations.access = checker
    operations._fetch_by_id = AsyncMock(return_value=channel)
    return operations


MODERATORS = pytest.mark.parametrize(
    ("org_admin", "chat_admin"),
    [(True, False), (False, True)],
    ids=["org-admin", "chat-domain-admin"],
)


@MODERATORS
async def test_moderators_cannot_view_someone_elses_self_conversation(
    org_admin: bool, chat_admin: bool
) -> None:
    channel = _self_dm()
    checker = _checker(org_admin=org_admin, chat_admin=chat_admin)

    with pytest.raises(PermissionDeniedError):
        await checker.check_access(generate_id(), channel.organization_id, channel)

    checker.is_org_admin.assert_not_awaited()
    checker.is_chat_domain_admin.assert_not_awaited()


async def test_owner_views_their_self_conversation() -> None:
    channel = _self_dm()
    checker = _checker(membership=_owner_row(channel))

    await checker.check_access(channel.owner_id, channel.organization_id, channel)


async def test_a_stray_member_row_does_not_open_someone_elses_self_conversation() -> None:
    channel = _self_dm()
    intruder = generate_id()
    stray = ChatChannelMember(
        channel_id=channel.id,
        subject_type=SubjectType.USER,
        subject_id=intruder,
        user_id=intruder,
    )
    checker = _checker(membership=stray)

    with pytest.raises(PermissionDeniedError):
        await checker.check_access(intruder, channel.organization_id, channel)
    with pytest.raises(PermissionDeniedError):
        await checker.require_send(intruder, channel)


@asynccontextmanager
async def _fake_session():
    yield MagicMock()


def _patch_principal(monkeypatch: pytest.MonkeyPatch, module, user_id: UUID, org_id: UUID) -> None:
    monkeypatch.setattr(module, "current_user_id", lambda: user_id)
    monkeypatch.setattr(module, "resolve_organization_id", lambda _raw: org_id)
    monkeypatch.setattr(module, "open_session", _fake_session)


def _patch_moderator(monkeypatch: pytest.MonkeyPatch, *, org_admin: bool, chat_admin: bool) -> None:
    monkeypatch.setattr(ChatAccessChecker, "require_org_member", AsyncMock())
    monkeypatch.setattr(ChatAccessChecker, "is_org_admin", AsyncMock(return_value=org_admin))
    monkeypatch.setattr(
        ChatAccessChecker, "is_chat_domain_admin", AsyncMock(return_value=chat_admin)
    )
    monkeypatch.setattr(ChatAccessChecker, "get_membership", AsyncMock(return_value=None))


@MODERATORS
async def test_get_channel_refuses_moderators(
    monkeypatch: pytest.MonkeyPatch, org_admin: bool, chat_admin: bool
) -> None:
    channel = _self_dm()
    _patch_principal(monkeypatch, channel_handlers, generate_id(), channel.organization_id)
    _patch_moderator(monkeypatch, org_admin=org_admin, chat_admin=chat_admin)
    monkeypatch.setattr(ChatChannelOperations, "_fetch_by_id", AsyncMock(return_value=channel))
    handlers = ChannelHandlers()
    handlers.storage = None
    handlers.search_indexer = None

    with pytest.raises(ConnectError) as raised:
        await handlers.get_channel(
            GetChannelRequest(
                organization_id=str(channel.organization_id), channel_id=str(channel.id)
            ),
            MagicMock(),
        )

    assert raised.value.code == Code.PERMISSION_DENIED


@MODERATORS
async def test_list_messages_refuses_moderators(
    monkeypatch: pytest.MonkeyPatch, org_admin: bool, chat_admin: bool
) -> None:
    channel = _self_dm()
    _patch_principal(monkeypatch, message_handlers, generate_id(), channel.organization_id)
    _patch_moderator(monkeypatch, org_admin=org_admin, chat_admin=chat_admin)
    monkeypatch.setattr(ChatAccessChecker, "get_channel", AsyncMock(return_value=channel))
    handlers = MessageHandlers()
    handlers.storage = None
    handlers.search_indexer = None

    with pytest.raises(ConnectError) as raised:
        await handlers.get_messages(
            GetMessagesRequest(
                organization_id=str(channel.organization_id), channel_id=str(channel.id)
            ),
            MagicMock(),
        )

    assert raised.value.code == Code.PERMISSION_DENIED


def _resolver_session(channel: ChatChannel, message: ChatMessage, member_channel_ids: list[UUID]):
    message_rows = MagicMock()
    message_rows.all.return_value = [
        SimpleNamespace(id=message.id, is_deleted=False, channel_id=channel.id)
    ]
    channel_rows = MagicMock()
    channel_rows.all.return_value = [
        SimpleNamespace(
            id=channel.id,
            channel_type=channel.channel_type,
            is_deleted=False,
            is_agent_dm=False,
            is_self_dm=True,
            owner_id=channel.owner_id,
        )
    ]
    memberships = MagicMock()
    memberships.scalars.return_value = member_channel_ids
    session = MagicMock()
    session.execute = AsyncMock(side_effect=[message_rows, channel_rows, memberships])
    return session


def _subject(user_id: UUID, organization_id: UUID, role: OrganizationRole, *, chat_admin=False):
    return AccessSubject(
        user_id=user_id,
        organization_id=organization_id,
        is_active_user=True,
        organization_role=role,
        group_ids=frozenset(),
        chat_domain_admin=chat_admin,
        support_role=None,
    )


@MODERATORS
async def test_message_and_attachment_parent_reads_refuse_moderators(
    org_admin: bool, chat_admin: bool
) -> None:
    # Attachment bytes and listings resolve their CHAT_MESSAGE parent through this batch.
    channel = _self_dm()
    message = ChatMessage(
        id=generate_id(),
        channel_id=channel.id,
        sender_id=channel.owner_id,
        sender_type=SenderType.USER,
        content="parking this link",
    )
    role = OrganizationRole.ADMIN if org_admin else OrganizationRole.MEMBER
    moderator = _subject(generate_id(), channel.organization_id, role, chat_admin=chat_admin)
    key = ResourceKey(ContentType.CHAT_MESSAGE, message.id)

    denied = await resolve_chat_resources(
        _resolver_session(channel, message, []),
        moderator,
        {ContentType.CHAT_MESSAGE: [message.id]},
    )
    owner = _subject(channel.owner_id, channel.organization_id, OrganizationRole.MEMBER)
    allowed = await resolve_chat_resources(
        _resolver_session(channel, message, [channel.id]),
        owner,
        {ContentType.CHAT_MESSAGE: [message.id]},
    )

    assert denied[key].can_view is False
    assert denied[key].role is None
    assert allowed[key].can_view is True


async def test_moderation_does_not_elevate_inside_a_self_conversation() -> None:
    channel = _self_dm()
    moderator = _checker(org_admin=True)
    moderator.session.scalar = AsyncMock(return_value=True)
    owner = _checker(org_admin=True, membership=_owner_row(channel))
    owner.session.scalar = AsyncMock(return_value=True)
    shared = _checker(org_admin=True)
    shared.session.scalar = AsyncMock(return_value=False)

    assert not await moderator.require_elevated(generate_id(), channel.organization_id, channel.id)
    assert await owner.require_elevated(channel.owner_id, channel.organization_id, channel.id)
    assert await shared.require_elevated(generate_id(), channel.organization_id, generate_id())


async def test_viewer_filter_keeps_only_the_owner() -> None:
    channel = _self_dm()
    admin_id, chat_admin_id, stray_id = (generate_id() for _ in range(3))
    rows = [
        SimpleNamespace(
            user_id=channel.owner_id,
            role=OrganizationRole.MEMBER,
            channel_member=True,
            chat_admin=False,
        ),
        SimpleNamespace(
            user_id=admin_id, role=OrganizationRole.OWNER, channel_member=False, chat_admin=False
        ),
        SimpleNamespace(
            user_id=chat_admin_id,
            role=OrganizationRole.MEMBER,
            channel_member=False,
            chat_admin=True,
        ),
        SimpleNamespace(
            user_id=stray_id, role=OrganizationRole.MEMBER, channel_member=True, chat_admin=False
        ),
    ]
    session = MagicMock()
    session.execute = AsyncMock(return_value=MagicMock(all=lambda: rows))

    viewers = await ChatAccessChecker(session).filter_viewers(
        channel.organization_id,
        channel,
        [admin_id, channel.owner_id, chat_admin_id, stray_id],
    )

    assert viewers == [channel.owner_id]


async def test_owner_cannot_add_members() -> None:
    channel = _self_dm()
    operations = _operations(channel, _checker(membership=_owner_row(channel)))

    with pytest.raises(ValidationError):
        await operations.add_members_with_subjects(
            channel.owner_id,
            channel.organization_id,
            channel.id,
            [ChatSubject.user(generate_id())],
        )

    operations.session.execute.assert_not_awaited()


@MODERATORS
async def test_moderators_cannot_add_members(org_admin: bool, chat_admin: bool) -> None:
    channel = _self_dm()
    operations = _operations(channel, _checker(org_admin=org_admin, chat_admin=chat_admin))

    with pytest.raises(PermissionDeniedError):
        await operations.add_members_with_subjects(
            generate_id(),
            channel.organization_id,
            channel.id,
            [ChatSubject.user(generate_id())],
        )


async def test_owner_cannot_convert_it_to_a_channel() -> None:
    channel = _self_dm()
    operations = _operations(channel, _checker(membership=_owner_row(channel)))

    with pytest.raises(ValidationError):
        await operations.convert_group_dm_to_channel(
            channel.owner_id, channel.organization_id, channel.id, "Notes"
        )

    assert channel.channel_type == ChannelType.DIRECT


async def test_nobody_can_leave_it() -> None:
    channel = _self_dm()
    operations = _operations(channel, _checker(membership=_owner_row(channel)))

    with pytest.raises(ValidationError):
        await operations.leave_channel(channel.owner_id, channel.organization_id, channel.id)
    with pytest.raises(ValidationError):
        await operations.leave_channel(generate_id(), channel.organization_id, channel.id)

    operations.session.execute.assert_not_awaited()


async def test_owner_cannot_rename_or_flag_it_default() -> None:
    channel = _self_dm()
    operations = _operations(channel, _checker(membership=_owner_row(channel)))

    with pytest.raises(ValidationError):
        await operations.update(
            channel.owner_id, channel.organization_id, channel.id, name="Renamed"
        )
    with pytest.raises(ValidationError):
        await operations.update(
            channel.owner_id, channel.organization_id, channel.id, is_default=True
        )

    assert channel.name == "Ada Lovelace"
    assert channel.is_default is False
    operations.session.commit.assert_not_awaited()


@MODERATORS
async def test_moderators_cannot_rename_it(org_admin: bool, chat_admin: bool) -> None:
    channel = _self_dm()
    operations = _operations(channel, _checker(org_admin=org_admin, chat_admin=chat_admin))

    with pytest.raises(PermissionDeniedError):
        await operations.update(generate_id(), channel.organization_id, channel.id, name="Mine")

    assert channel.name == "Ada Lovelace"


async def test_owner_cannot_tag_the_conversation_itself() -> None:
    channel = _self_dm()
    access = TagTargetAccess(MagicMock())
    checker = _checker(membership=_owner_row(channel))
    checker.get_channel = AsyncMock(return_value=channel)

    with pytest.MonkeyPatch.context() as patched:
        patched.setattr("uniffy.domains.tags.targets.ChatAccessChecker", lambda _s: checker)
        with pytest.raises(ValidationError):
            await access._require_chat_send(
                channel.owner_id, channel.organization_id, ContentType.CHAT, channel.id
            )


async def test_calls_are_refused() -> None:
    channel = _self_dm()
    operations = CallOperations.__new__(CallOperations)
    operations.access = _checker(membership=_owner_row(channel))
    operations.access.get_channel = AsyncMock(return_value=channel)
    operations._require_calls_enabled = AsyncMock()

    with pytest.raises(ValidationError):
        await operations.initiate_call(
            channel.owner_id, channel.organization_id, channel.id, device_id="tab"
        )

    operations._require_calls_enabled.assert_not_awaited()


async def test_typing_publishes_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    channel = _self_dm()
    _patch_principal(monkeypatch, channel_handlers, channel.owner_id, channel.organization_id)
    monkeypatch.setattr(channel_handlers, "current_sender_info", lambda: ("Ada", None))
    monkeypatch.setattr(ChatAccessChecker, "get_channel", AsyncMock(return_value=channel))
    require_send = AsyncMock()
    monkeypatch.setattr(ChatAccessChecker, "require_send", require_send)
    members = AsyncMock()
    publish = AsyncMock()
    monkeypatch.setattr(channel_handlers, "fetch_channel_members", members)
    monkeypatch.setattr(
        "uniffy.domains.chat.streaming.publisher.publish_channel_event_to_members", publish
    )

    await ChannelHandlers().set_typing(
        SetTypingRequest(organization_id=str(channel.organization_id), channel_id=str(channel.id)),
        MagicMock(),
    )

    require_send.assert_awaited_once()
    members.assert_not_awaited()
    publish.assert_not_awaited()


async def test_own_messages_raise_no_unread_or_notification(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    channel = _self_dm()
    message = ChatMessage(
        id=generate_id(),
        channel_id=channel.id,
        sender_id=channel.owner_id,
        sender_type=SenderType.USER,
        content="remember the invoice",
    )
    notify = AsyncMock()
    events = AsyncMock()
    monkeypatch.setattr("uniffy.domains.chat.messages.notifications.emit_notification", notify)
    monkeypatch.setattr(
        "uniffy.domains.chat.messages.notifications.publish_user_chat_events", events
    )
    notifier = MessageNotifications()
    notifier.session = MagicMock()

    await notifier._publish_unread_notifications(
        channel, channel.owner_id, [channel.owner_id], {channel.owner_id}, message_id=message.id
    )
    await notifier._emit_send_notifications(
        message,
        channel,
        channel.owner_id,
        None,
        "Ada",
        [channel.owner_id],
        {channel.owner_id},
    )

    notify.assert_not_awaited()
    assert all(not call.args[0] for call in events.await_args_list)

    # The same path notifies a real peer, so the silence above is the self case.
    peer_dm = ChatChannel(
        id=generate_id(),
        organization_id=channel.organization_id,
        owner_id=channel.owner_id,
        name="Ada Lovelace, Grace Hopper",
        slug="ada-grace",
        channel_type=ChannelType.DIRECT,
    )
    await notifier._emit_send_notifications(
        message, peer_dm, channel.owner_id, None, "Ada", [channel.owner_id, generate_id()]
    )
    notify.assert_awaited_once()


async def test_a_dm_request_naming_only_the_caller_opens_the_self_conversation() -> None:
    channel = _self_dm()
    operations = _operations(channel, _checker())
    operations.open_self_dm = AsyncMock(return_value=channel)
    operations._find_existing_dm_by_subjects = AsyncMock()
    operations._find_existing_dm = AsyncMock()

    by_subject = await operations.create_dm_with_subjects(
        channel.owner_id,
        channel.organization_id,
        [ChatSubject.user(channel.owner_id)],
    )
    by_user = await operations.create_dm(
        channel.owner_id, channel.organization_id, [channel.owner_id]
    )

    assert by_subject is channel
    assert by_user is channel
    operations._find_existing_dm_by_subjects.assert_not_awaited()
    operations._find_existing_dm.assert_not_awaited()


async def test_an_empty_dm_request_is_still_refused() -> None:
    channel = _self_dm()
    operations = _operations(channel, _checker())
    operations.open_self_dm = AsyncMock()
    operations._require_active_user_subjects = AsyncMock()

    with pytest.raises(ValidationError):
        await operations.create_dm_with_subjects(channel.owner_id, channel.organization_id, [])

    operations.open_self_dm.assert_not_awaited()


async def test_a_pair_lookup_refuses_identical_subjects() -> None:
    operations = _operations(_self_dm(), _checker())
    me = ChatSubject.user(generate_id())

    with pytest.raises(ValueError):
        await operations._find_existing_dm_by_subjects(generate_id(), me, me)
    with pytest.raises(ValueError):
        await operations._find_existing_dm(generate_id(), me.subject_id, me.subject_id)

    operations.session.execute.assert_not_awaited()


def test_the_wire_channel_carries_the_self_flag() -> None:
    channel = _self_dm()

    assert channel_to_proto(channel).is_self_dm is True
    channel.is_self_dm = False
    assert channel_to_proto(channel).is_self_dm is False


async def test_it_cannot_host_a_calendar_meeting(monkeypatch: pytest.MonkeyPatch) -> None:
    channel = _self_dm()
    monkeypatch.setattr(ChatAccessChecker, "get_channel", AsyncMock(return_value=channel))
    monkeypatch.setattr(ChatAccessChecker, "check_access", AsyncMock())
    binding = ChannelBindingOperations(SimpleNamespace(session=MagicMock()))

    with pytest.raises(ValidationError):
        await binding._validate_channel_binding(
            channel.owner_id, channel.organization_id, channel.id
        )
