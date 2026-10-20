"""Automatic enrollment must never grant access to private conversations."""

import asyncio
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.chat.channel import ChannelType, ChatChannel, ChatChannelStats
from uniffy.core.models.chat.channel_member import ChannelRole, ChatChannelMember
from uniffy.core.types import SubjectType, generate_id
from uniffy.domains.chat.access import lock_channel_visibility
from uniffy.domains.chat.channels import updates
from uniffy.domains.chat.channels.membership import stage_default_channel_memberships
from uniffy.domains.chat.channels.operations import ChatChannelOperations
from uniffy.infrastructure.database import open_session
from uniffy.tests.integration.access.recording_search import recording_indexer

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _operations(session) -> ChatChannelOperations:
    operations = ChatChannelOperations(session, search_indexer=recording_indexer())
    operations._refresh_channel_live_state = AsyncMock()
    operations._publish_channel_updated = AsyncMock()
    return operations


async def _channel(session, access, channel_type, *, is_default=False, **flags):
    channel = ChatChannel(
        organization_id=access.org_id,
        owner_id=access.member_id,
        name="Enrollment test",
        slug=f"enrollment-{generate_id()}",
        channel_type=channel_type,
        is_default=is_default,
        **flags,
    )
    session.add(channel)
    await session.flush()
    session.add_all([
        ChatChannelStats(channel_id=channel.id, member_count=1),
        ChatChannelMember(
            channel_id=channel.id,
            subject_type=SubjectType.USER,
            subject_id=access.member_id,
            user_id=access.member_id,
            role=ChannelRole.OWNER,
        ),
    ])
    await session.commit()
    return channel


@pytest.mark.parametrize(
    "channel_type", [ChannelType.PRIVATE, ChannelType.DIRECT, ChannelType.GROUP_DM]
)
async def test_owner_cannot_make_private_conversation_default(session, access, channel_type) -> None:
    channel = await _channel(session, access, channel_type)

    with pytest.raises(ValidationError, match="public"):
        await _operations(session).update(
            access.member_id, access.org_id, channel.id, is_default=True, name="Changed"
        )

    await session.refresh(channel)
    assert channel.is_default is False
    assert channel.name == "Enrollment test"


@pytest.mark.parametrize(
    "channel_type", [ChannelType.PRIVATE, ChannelType.DIRECT, ChannelType.GROUP_DM]
)
async def test_creation_rejects_nonpublic_default(session, access, channel_type) -> None:
    slug = f"rejected-{generate_id()}"
    with pytest.raises(ValidationError, match="public"):
        await _operations(session).create_channel(
            access.member_id, access.org_id, slug, channel_type, is_default=True
        )

    assert await session.scalar(select(ChatChannel.id).where(ChatChannel.slug == slug)) is None


async def test_default_update_requires_channel_privileges(session, access) -> None:
    channel = await _channel(session, access, ChannelType.PUBLIC)
    with pytest.raises(PermissionDeniedError):
        await _operations(session).update(access.peer_id, access.org_id, channel.id, is_default=True)
    await session.refresh(channel)
    assert channel.is_default is False


async def test_public_default_enrolls_members_and_can_be_disabled(session, access) -> None:
    channel = await _channel(session, access, ChannelType.PUBLIC)
    await _operations(session).update(access.member_id, access.org_id, channel.id, is_default=True)

    enrolled = await stage_default_channel_memberships(session, access.peer_id, access.org_id)
    await session.commit()

    assert enrolled == [channel.id]
    assert (
        await session.scalar(
            select(ChatChannelMember.subject_id).where(
                ChatChannelMember.channel_id == channel.id,
                ChatChannelMember.subject_id == access.peer_id,
            )
        )
        == access.peer_id
    )
    assert (
        await session.scalar(
            select(ChatChannelStats.member_count).where(ChatChannelStats.channel_id == channel.id)
        )
        == 2
    )

    await _operations(session).update(access.member_id, access.org_id, channel.id, is_default=False)
    assert await stage_default_channel_memberships(session, access.admin_id, access.org_id) == []


async def test_enrollment_ignores_invalid_defaults_already_stored(session, access) -> None:
    public = await _channel(session, access, ChannelType.PUBLIC, is_default=True)
    for channel_type in (ChannelType.PRIVATE, ChannelType.DIRECT, ChannelType.GROUP_DM):
        await _channel(session, access, channel_type, is_default=True)
    await _channel(session, access, ChannelType.DIRECT, is_default=True, is_self_dm=True)
    await _channel(session, access, ChannelType.DIRECT, is_default=True, is_agent_dm=True)
    await _channel(session, access, ChannelType.PUBLIC, is_default=True, is_deleted=True)

    enrolled = await stage_default_channel_memberships(session, access.peer_id, access.org_id)
    await session.commit()

    assert enrolled == [public.id]
    joined = (
        (
            await session.execute(
                select(ChatChannelMember.channel_id).where(
                    ChatChannelMember.subject_id == access.peer_id,
                    ChatChannelMember.channel_id.in_(
                        select(ChatChannel.id).where(ChatChannel.organization_id == access.org_id)
                    ),
                )
            )
        )
        .scalars()
        .all()
    )
    assert joined == [public.id]


async def test_default_update_rechecks_visibility_after_concurrent_change(
    session, access, monkeypatch
) -> None:
    channel = await _channel(session, access, ChannelType.PUBLIC)
    attempting_lock = asyncio.Event()

    async def observed_lock(*args, **kwargs):
        attempting_lock.set()
        return await lock_channel_visibility(*args, **kwargs)

    monkeypatch.setattr(updates, "lock_channel_visibility", observed_lock)

    async def make_default():
        async with open_session() as writer:
            with pytest.raises(ValidationError, match="public"):
                await _operations(writer).update(
                    access.member_id, access.org_id, channel.id, is_default=True
                )

    async with open_session() as editor:
        locked = await lock_channel_visibility(editor, channel.id, access.org_id)
        task = asyncio.create_task(make_default())
        try:
            await asyncio.wait_for(attempting_lock.wait(), timeout=5)
            locked.channel_type = ChannelType.PRIVATE
            await editor.commit()
            await asyncio.wait_for(task, timeout=5)
        finally:
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    await session.refresh(channel)
    assert channel.channel_type == ChannelType.PRIVATE
    assert channel.is_default is False
