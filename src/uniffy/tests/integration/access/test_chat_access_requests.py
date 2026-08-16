"""Private-chat access requests delegate to canonical channel membership."""

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from uniffy.core.models.chat.channel import ChatChannel, ChatChannelStats, ChannelType
from uniffy.core.models.chat.channel_member import ChannelRole, ChatChannelMember
from uniffy.core.models.chat.message import ChatMessage
from uniffy.core.models.chat.search_acl_refresh import ChatSearchAclRefresh
from uniffy.core.models.permissions.content_access_request import ContentAccessRequestState
from uniffy.core.types import SubjectType, generate_id
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.permissions.access_requests import (
    AccessRequestDecision,
    ContentAccessRequestOperations,
    RequestAccessOutcome,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_private_message_request_grants_canonical_channel_access(session, access) -> None:
    channel = ChatChannel(
        organization_id=access.org_id,
        owner_id=access.member_id,
        name="Private request channel",
        slug=f"private-request-{generate_id()}",
        channel_type=ChannelType.PRIVATE,
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
    message = ChatMessage(
        channel_id=channel.id,
        sender_id=access.member_id,
        content="Private message",
    )
    session.add(message)
    await session.commit()

    operations = ContentAccessRequestOperations(session)
    message_urn = f"urn:uniffy:content:CHAT_MESSAGE:{message.id}"
    created = await operations.request_access(
        requester_id=access.peer_id,
        organization_id=access.org_id,
        requested_urn=message_urn,
        message="Please add me to the private channel.",
    )
    assert created.outcome == RequestAccessOutcome.CREATED
    assert created.view is not None
    assert created.view.request.canonical_content_id == channel.id

    channel_duplicate = await operations.request_access(
        requester_id=access.peer_id,
        organization_id=access.org_id,
        requested_urn=f"urn:uniffy:content:CHAT:{channel.id}",
        message="",
    )
    assert channel_duplicate.outcome == RequestAccessOutcome.ALREADY_PENDING
    assert channel_duplicate.view is not None
    assert channel_duplicate.view.request.id == created.view.request.id

    with patch(
        "uniffy.domains.chat.channels.operations.enqueue_chat_search_acl_refresh",
        new=AsyncMock(),
    ):
        approved = await operations.respond(
            actor_user_id=access.member_id,
            organization_id=access.org_id,
            request_id=created.view.request.id,
            decision=AccessRequestDecision.APPROVE,
            approved_role=None,
            decision_note="Approved.",
        )

    assert approved.request.state == ContentAccessRequestState.APPROVED
    assert approved.requester_has_access is True
    membership = (
        await session.execute(
            select(ChatChannelMember).where(
                ChatChannelMember.channel_id == channel.id,
                ChatChannelMember.subject_type == SubjectType.USER,
                ChatChannelMember.subject_id == access.peer_id,
            )
        )
    ).scalar_one()
    assert membership.role == ChannelRole.MEMBER

    await ChatAccessChecker(session).check_access(access.peer_id, access.org_id, channel)
    refresh = await session.get(ChatSearchAclRefresh, channel.id)
    assert refresh is not None

