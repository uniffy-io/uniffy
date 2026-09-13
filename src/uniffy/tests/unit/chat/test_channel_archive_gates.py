from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.audit.actions import Action
from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.channel_member import ChannelRole, ChatChannelMember
from uniffy.core.types import SubjectType, generate_id
from uniffy.domains.chat.channels import lifecycle as lifecycle_module
from uniffy.domains.chat.channels.operations import ChatChannelOperations


def _archived_channel() -> ChatChannel:
    channel = ChatChannel(
        organization_id=generate_id(),
        owner_id=generate_id(),
        name="paused-project",
        slug="paused-project",
        channel_type=ChannelType.PRIVATE,
    )
    channel.is_archived = True
    return channel


def _member(channel: ChatChannel, user_id, role: ChannelRole) -> ChatChannelMember:
    return ChatChannelMember(
        channel_id=channel.id,
        subject_type=SubjectType.USER,
        subject_id=user_id,
        user_id=user_id,
        role=role,
    )


def _operations(
    channel: ChatChannel,
    *,
    role: ChannelRole | None,
    org_admin: bool = False,
    chat_admin: bool = False,
) -> tuple[ChatChannelOperations, object]:
    user_id = generate_id()
    operations = ChatChannelOperations.__new__(ChatChannelOperations)
    operations.session = MagicMock()
    operations.session.commit = AsyncMock()
    operations.session.refresh = AsyncMock()
    operations.get_by_id = AsyncMock(return_value=channel)
    operations.access = MagicMock()
    operations.access.is_org_admin = AsyncMock(return_value=org_admin)
    operations.access.is_chat_domain_admin = AsyncMock(return_value=chat_admin)
    operations.access.get_membership = AsyncMock(
        return_value=_member(channel, user_id, role) if role else None
    )
    operations._publish_channel_updated = AsyncMock()
    return operations, user_id


@pytest.fixture
def audit(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    recorder = AsyncMock()
    monkeypatch.setattr(lifecycle_module, "write_audit_event", recorder)
    return recorder


async def test_owner_restores_an_archived_channel(audit: AsyncMock) -> None:
    channel = _archived_channel()
    operations, user_id = _operations(channel, role=ChannelRole.OWNER)

    restored = await operations.unarchive_channel(user_id, channel.organization_id, channel.id)

    assert restored.is_archived is False
    assert audit.await_args.kwargs["action"] == Action.CHAT_CHANNEL_UNARCHIVED
    assert audit.await_args.kwargs["details"] == {"name": "paused-project"}
    operations.session.commit.assert_awaited_once()
    operations._publish_channel_updated.assert_awaited_once()


async def test_audit_row_is_written_before_the_commit(audit: AsyncMock) -> None:
    channel = _archived_channel()
    operations, user_id = _operations(channel, role=ChannelRole.OWNER)
    order: list[str] = []
    audit.side_effect = lambda *a, **kw: order.append("audit")
    operations.session.commit.side_effect = lambda: order.append("commit")

    await operations.unarchive_channel(user_id, channel.organization_id, channel.id)

    assert order == ["audit", "commit"]


async def test_org_admin_restores_without_channel_membership(audit: AsyncMock) -> None:
    channel = _archived_channel()
    operations, user_id = _operations(channel, role=None, org_admin=True)

    restored = await operations.unarchive_channel(user_id, channel.organization_id, channel.id)

    assert restored.is_archived is False


async def test_chat_domain_admin_restores_without_channel_membership(audit: AsyncMock) -> None:
    channel = _archived_channel()
    operations, user_id = _operations(channel, role=None, chat_admin=True)

    restored = await operations.unarchive_channel(user_id, channel.organization_id, channel.id)

    assert restored.is_archived is False


@pytest.mark.parametrize("role", [ChannelRole.MEMBER, ChannelRole.ADMIN, None])
async def test_everyone_below_owner_is_refused(audit: AsyncMock, role) -> None:
    channel = _archived_channel()
    operations, user_id = _operations(channel, role=role)

    with pytest.raises(PermissionDeniedError):
        await operations.unarchive_channel(user_id, channel.organization_id, channel.id)

    assert channel.is_archived is True
    audit.assert_not_awaited()
    operations.session.commit.assert_not_awaited()


async def test_a_channel_that_is_not_archived_is_refused(audit: AsyncMock) -> None:
    channel = _archived_channel()
    channel.is_archived = False
    operations, user_id = _operations(channel, role=ChannelRole.OWNER)

    with pytest.raises(ValidationError):
        await operations.unarchive_channel(user_id, channel.organization_id, channel.id)

    audit.assert_not_awaited()
    operations.session.commit.assert_not_awaited()
