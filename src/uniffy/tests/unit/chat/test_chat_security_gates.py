from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest

from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.types import SubjectType, generate_id
from uniffy.domains.chat import access as access_module
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.chat.channels.operations import ChatChannelOperations
from uniffy.domains.chat.streaming import publisher as streaming_publisher
from uniffy.domains.chat.subjects import ChatSubject


def _channel(channel_type: ChannelType = ChannelType.PRIVATE) -> ChatChannel:
    return ChatChannel(
        organization_id=generate_id(),
        owner_id=generate_id(),
        name="security",
        slug="security",
        channel_type=channel_type,
    )


def _stale_member(channel: ChatChannel, user_id) -> ChatChannelMember:
    return ChatChannelMember(
        channel_id=channel.id,
        subject_type=SubjectType.USER,
        subject_id=user_id,
        user_id=user_id,
    )


async def test_inactive_org_member_is_denied_despite_private_channel_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = generate_id()
    channel = _channel()
    checker = ChatAccessChecker(MagicMock())
    checker.get_membership = AsyncMock(return_value=_stale_member(channel, user_id))
    monkeypatch.setattr(
        access_module,
        "is_active_member",
        AsyncMock(return_value=False),
    )

    with pytest.raises(PermissionDeniedError):
        await checker.check_access(user_id, channel.organization_id, channel)
    with pytest.raises(PermissionDeniedError):
        await checker.require_send(user_id, channel)
    with pytest.raises(PermissionDeniedError):
        await checker.require_elevated(user_id, channel.organization_id, channel.id)

    checker.get_membership.assert_not_awaited()


async def test_inactive_org_member_is_denied_from_public_channel(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = generate_id()
    channel = _channel(ChannelType.PUBLIC)
    checker = ChatAccessChecker(MagicMock())
    monkeypatch.setattr(
        access_module,
        "is_active_member",
        AsyncMock(return_value=False),
    )

    with pytest.raises(PermissionDeniedError):
        await checker.check_access(user_id, channel.organization_id, channel)


async def test_batch_viewers_apply_private_membership_and_moderation() -> None:
    member_id, admin_id, chat_admin_id, outsider_id = (generate_id() for _ in range(4))
    rows = [
        SimpleNamespace(
            user_id=member_id,
            role=OrganizationRole.MEMBER,
            channel_member=True,
            chat_admin=False,
        ),
        SimpleNamespace(
            user_id=admin_id,
            role=OrganizationRole.ADMIN,
            channel_member=False,
            chat_admin=False,
        ),
        SimpleNamespace(
            user_id=chat_admin_id,
            role=OrganizationRole.MEMBER,
            channel_member=False,
            chat_admin=True,
        ),
        SimpleNamespace(
            user_id=outsider_id,
            role=OrganizationRole.MEMBER,
            channel_member=False,
            chat_admin=False,
        ),
    ]
    session = MagicMock()
    session.execute = AsyncMock(return_value=MagicMock(all=lambda: rows))
    channel = _channel(ChannelType.PRIVATE)

    allowed = await ChatAccessChecker(session).filter_viewers(
        channel.organization_id,
        channel,
        [member_id, admin_id, chat_admin_id, outsider_id],
    )

    assert allowed == [member_id, admin_id, chat_admin_id]


async def test_batch_viewers_keep_candidate_order_for_public_channels() -> None:
    first, second = generate_id(), generate_id()
    rows = [
        SimpleNamespace(
            user_id=second,
            role=OrganizationRole.MEMBER,
            channel_member=False,
            chat_admin=False,
        ),
        SimpleNamespace(
            user_id=first,
            role=OrganizationRole.MEMBER,
            channel_member=False,
            chat_admin=False,
        ),
    ]
    session = MagicMock()
    session.execute = AsyncMock(return_value=MagicMock(all=lambda: rows))
    channel = _channel(ChannelType.PUBLIC)

    allowed = await ChatAccessChecker(session).filter_viewers(
        channel.organization_id,
        channel,
        [first, second],
    )

    assert allowed == [first, second]


async def test_forward_source_viewers_require_personal_membership_for_moderators() -> None:
    member_id, admin_id, chat_admin_id = (generate_id() for _ in range(3))
    rows = [
        SimpleNamespace(
            user_id=member_id,
            role=OrganizationRole.MEMBER,
            channel_member=True,
            chat_admin=False,
        ),
        SimpleNamespace(
            user_id=admin_id,
            role=OrganizationRole.ADMIN,
            channel_member=False,
            chat_admin=False,
        ),
        SimpleNamespace(
            user_id=chat_admin_id,
            role=OrganizationRole.MEMBER,
            channel_member=False,
            chat_admin=True,
        ),
    ]
    session = MagicMock()
    session.execute = AsyncMock(return_value=MagicMock(all=lambda: rows))
    channel = _channel(ChannelType.DIRECT)

    allowed = await ChatAccessChecker(session).filter_forward_source_viewers(
        channel.organization_id,
        channel,
        [member_id, admin_id, chat_admin_id],
    )

    assert allowed == [member_id]


async def test_batch_forward_source_access_combines_public_and_private_membership() -> None:
    user_id = generate_id()
    public_channel = _channel(ChannelType.PUBLIC)
    private_member_channel = _channel(ChannelType.PRIVATE)
    private_denied_channel = _channel(ChannelType.PRIVATE)
    private_member_channel.organization_id = public_channel.organization_id
    private_denied_channel.organization_id = public_channel.organization_id
    channel_result = MagicMock()
    channel_result.scalars.return_value.all.return_value = [
        public_channel,
        private_member_channel,
        private_denied_channel,
    ]
    membership_result = MagicMock()
    membership_result.scalars.return_value = [private_member_channel.id]
    session = MagicMock()
    session.execute = AsyncMock(side_effect=[channel_result, membership_result])
    checker = ChatAccessChecker(session)
    checker.is_org_member = AsyncMock(return_value=True)
    checker.is_org_admin = AsyncMock(return_value=False)
    checker.is_chat_domain_admin = AsyncMock(return_value=False)

    allowed = await checker.filter_forward_source_channel_ids(
        user_id,
        public_channel.organization_id,
        [public_channel.id, private_member_channel.id, private_denied_channel.id],
    )

    assert allowed == {public_channel.id, private_member_channel.id}


async def test_batch_forward_source_access_requires_dm_membership_for_moderators() -> None:
    user_id = generate_id()
    private_channel = _channel(ChannelType.PRIVATE)
    direct_member_channel = _channel(ChannelType.DIRECT)
    direct_denied_channel = _channel(ChannelType.DIRECT)
    direct_member_channel.organization_id = private_channel.organization_id
    direct_denied_channel.organization_id = private_channel.organization_id
    channel_result = MagicMock()
    channel_result.scalars.return_value.all.return_value = [
        private_channel,
        direct_member_channel,
        direct_denied_channel,
    ]
    membership_result = MagicMock()
    membership_result.scalars.return_value = [direct_member_channel.id]
    session = MagicMock()
    session.execute = AsyncMock(side_effect=[channel_result, membership_result])
    checker = ChatAccessChecker(session)
    checker.is_org_member = AsyncMock(return_value=True)
    checker.is_org_admin = AsyncMock(return_value=True)
    checker.is_chat_domain_admin = AsyncMock(return_value=False)

    allowed = await checker.filter_forward_source_channel_ids(
        user_id,
        private_channel.organization_id,
        [private_channel.id, direct_member_channel.id, direct_denied_channel.id],
    )

    assert allowed == {private_channel.id, direct_member_channel.id}


async def test_batch_forward_source_access_denies_inactive_org_member_without_queries() -> None:
    checker = ChatAccessChecker(MagicMock())
    checker.session.execute = AsyncMock()
    checker.is_org_member = AsyncMock(return_value=False)

    allowed = await checker.filter_forward_source_channel_ids(
        generate_id(),
        generate_id(),
        [generate_id()],
    )

    assert allowed == set()
    checker.session.execute.assert_not_awaited()


def _denied_operations() -> tuple[ChatChannelOperations, tuple[UUID, UUID]]:
    user_id = generate_id()
    organization_id = generate_id()
    access = MagicMock()
    access.require_org_member = AsyncMock(
        side_effect=PermissionDeniedError("access", "organization")
    )
    operations = ChatChannelOperations.__new__(ChatChannelOperations)
    operations.session = MagicMock()
    operations.session.execute = AsyncMock()
    operations.access = access
    return operations, (user_id, organization_id)


async def test_non_member_cannot_create_channel() -> None:
    operations, (user_id, organization_id) = _denied_operations()

    with pytest.raises(PermissionDeniedError):
        await operations.create_channel(
            user_id,
            organization_id,
            "blocked",
            ChannelType.PRIVATE,
        )

    operations.session.execute.assert_not_awaited()


async def test_non_member_cannot_create_user_dm() -> None:
    operations, (user_id, organization_id) = _denied_operations()

    with pytest.raises(PermissionDeniedError):
        await operations.create_dm(user_id, organization_id, [generate_id()])

    operations.session.execute.assert_not_awaited()


async def test_non_member_cannot_create_subject_dm() -> None:
    operations, (user_id, organization_id) = _denied_operations()

    with pytest.raises(PermissionDeniedError):
        await operations.create_dm_with_subjects(
            user_id,
            organization_id,
            [ChatSubject.user(generate_id())],
        )

    operations.session.execute.assert_not_awaited()


async def test_non_member_cannot_create_agent_chat() -> None:
    operations, (user_id, organization_id) = _denied_operations()

    with pytest.raises(PermissionDeniedError):
        await operations.create_agent_chat(
            user_id,
            organization_id,
            generate_id(),
        )

    operations.session.execute.assert_not_awaited()


async def test_member_removal_event_reaches_removed_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    remaining_user_id = generate_id()
    removed_user_id = generate_id()
    channel_id = generate_id()
    operations = ChatChannelOperations.__new__(ChatChannelOperations)
    operations._get_all_member_ids = AsyncMock(return_value=[remaining_user_id])
    publish = AsyncMock()
    monkeypatch.setattr(streaming_publisher, "publish_channel_event_to_members", publish)

    await operations._publish_members_changed(
        channel_id,
        [removed_user_id],
        added=False,
    )

    assert publish.await_args.args[0] == [remaining_user_id, removed_user_id]
