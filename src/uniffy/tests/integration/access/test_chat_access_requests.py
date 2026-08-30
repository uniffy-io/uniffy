"""Private-chat access requests delegate to canonical channel membership."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import func, select

from uniffy.core.audit.actions import Action
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.chat.channel import ChannelType, ChatChannel, ChatChannelStats
from uniffy.core.models.chat.channel_member import ChannelRole, ChatChannelMember
from uniffy.core.models.chat.message import ChatMessage
from uniffy.core.models.chat.search_acl_refresh import ChatSearchAclRefresh
from uniffy.core.models.permissions.content_access_request import (
    ContentAccessRequest,
    ContentAccessRequestState,
)
from uniffy.core.search import SearchIndexer
from uniffy.core.types import SubjectType, generate_id
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.permissions.requests.operations import (
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
    channel_id = channel.id
    session.add_all([
        ChatChannelStats(channel_id=channel_id, member_count=1),
        ChatChannelMember(
            channel_id=channel_id,
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

    operations = ContentAccessRequestOperations(session, MagicMock(spec=SearchIndexer))
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
        requested_urn=f"urn:uniffy:content:CHAT:{channel_id}",
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
                ChatChannelMember.channel_id == channel_id,
                ChatChannelMember.subject_type == SubjectType.USER,
                ChatChannelMember.subject_id == access.peer_id,
            )
        )
    ).scalar_one()
    assert membership.role == ChannelRole.MEMBER

    await ChatAccessChecker(session).check_access(access.peer_id, access.org_id, channel)
    refresh = await session.get(ChatSearchAclRefresh, channel.id)
    assert refresh is not None


async def test_chat_approval_rolls_back_membership_and_request_together(session, access) -> None:
    channel = ChatChannel(
        organization_id=access.org_id,
        owner_id=access.member_id,
        name="Private rollback channel",
        slug=f"private-rollback-{generate_id()}",
        channel_type=ChannelType.PRIVATE,
    )
    session.add(channel)
    await session.flush()
    channel_id = channel.id
    session.add_all([
        ChatChannelStats(channel_id=channel_id, member_count=1),
        ChatChannelMember(
            channel_id=channel_id,
            subject_type=SubjectType.USER,
            subject_id=access.member_id,
            user_id=access.member_id,
            role=ChannelRole.OWNER,
        ),
    ])
    await session.commit()

    operations = ContentAccessRequestOperations(session, MagicMock(spec=SearchIndexer))
    created = await operations.request_access(
        requester_id=access.peer_id,
        organization_id=access.org_id,
        requested_urn=f"urn:uniffy:content:CHAT:{channel_id}",
        message="",
    )
    assert created.view is not None
    request_id = created.view.request.id

    with (
        patch.object(
            operations,
            "_write_audit",
            new=AsyncMock(side_effect=RuntimeError("request audit unavailable")),
        ),
        pytest.raises(RuntimeError, match="request audit unavailable"),
    ):
        await operations.respond(
            actor_user_id=access.member_id,
            organization_id=access.org_id,
            request_id=request_id,
            decision=AccessRequestDecision.APPROVE,
            approved_role=None,
            decision_note="",
        )

    request = await session.get(ContentAccessRequest, request_id)
    membership = (
        await session.execute(
            select(ChatChannelMember).where(
                ChatChannelMember.channel_id == channel_id,
                ChatChannelMember.subject_type == SubjectType.USER,
                ChatChannelMember.subject_id == access.peer_id,
            )
        )
    ).scalar_one_or_none()
    stats = await session.get(ChatChannelStats, channel_id)
    member_audits = (
        await session.execute(
            select(func.count())
            .select_from(AuditEvent)
            .where(
                AuditEvent.organization_id == access.org_id,
                AuditEvent.resource_id == channel_id,
                AuditEvent.action == Action.CHAT_CHANNEL_MEMBER_ADDED,
            )
        )
    ).scalar_one()

    assert request is not None
    assert request.state == ContentAccessRequestState.PENDING
    assert membership is None
    assert stats is not None
    assert stats.member_count == 1
    assert member_audits == 0
