"""Flip a channel's visibility against real Postgres, both directions.

The unit tests prove which patch the job builds. These prove the rows that
survive a real transaction: the channel type, the audit row that has to commit
with it, the durable refresh fact the search rewrite depends on, and the pending
access request an open-up makes moot.
"""

from types import SimpleNamespace as NS
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit.actions import Action
from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.chat.channel import ChannelType, ChatChannel, ChatChannelStats
from uniffy.core.models.chat.channel_member import ChannelRole, ChatChannelMember
from uniffy.core.models.chat.search_acl_refresh import ChatSearchAclRefresh
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.models.permissions.content_access_request import (
    ContentAccessRequest,
    ContentAccessRequestState,
)
from uniffy.core.types import ContentType, SubjectType, generate_id
from uniffy.domains.chat.channels.operations import ChatChannelOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _seed(db_session: AsyncSession) -> NS:
    suffix = generate_id().hex[:12]

    owner = User(
        email=f"icv-{suffix}@test.local",
        username=f"icv-{suffix}",
        full_name="Visibility Owner",
        hashed_password="x",
    )
    outsider = User(
        email=f"icv-out-{suffix}@test.local",
        username=f"icv-out-{suffix}",
        full_name="Curious Colleague",
        hashed_password="x",
    )
    org = Organization(name=f"icv {suffix}", slug=f"icv-{suffix}")
    db_session.add_all([owner, outsider, org])
    await db_session.flush()

    db_session.add_all([
        OrganizationMember(user_id=owner.id, organization_id=org.id, role=OrganizationRole.MEMBER),
        OrganizationMember(
            user_id=outsider.id, organization_id=org.id, role=OrganizationRole.MEMBER
        ),
    ])

    channels = {}
    for name, channel_type in (
        ("open-forum", ChannelType.PUBLIC),
        ("closed-doors", ChannelType.PRIVATE),
    ):
        channel = ChatChannel(
            organization_id=org.id,
            owner_id=owner.id,
            name=f"{name}-{suffix}",
            slug=f"{name}-{suffix}",
            channel_type=channel_type,
        )
        db_session.add(channel)
        await db_session.flush()
        db_session.add_all([
            ChatChannelStats(channel_id=channel.id),
            ChatChannelMember(
                channel_id=channel.id,
                subject_type=SubjectType.USER,
                subject_id=owner.id,
                user_id=owner.id,
                role=ChannelRole.OWNER,
            ),
        ])
        channels[name] = channel
    await db_session.commit()

    return NS(
        org_id=org.id,
        owner_id=owner.id,
        outsider_id=outsider.id,
        public_id=channels["open-forum"].id,
        private_id=channels["closed-doors"].id,
        channel_ids=[channel.id for channel in channels.values()],
    )


async def _teardown(db_session: AsyncSession, env: NS) -> None:
    await db_session.rollback()
    await db_session.execute(
        delete(ContentAccessRequest).where(ContentAccessRequest.organization_id == env.org_id)
    )
    await db_session.execute(
        delete(ChatSearchAclRefresh).where(ChatSearchAclRefresh.channel_id.in_(env.channel_ids))
    )
    await db_session.execute(
        delete(ChatChannelMember).where(ChatChannelMember.channel_id.in_(env.channel_ids))
    )
    await db_session.execute(
        delete(ChatChannelStats).where(ChatChannelStats.channel_id.in_(env.channel_ids))
    )
    await db_session.execute(delete(ChatChannel).where(ChatChannel.id.in_(env.channel_ids)))
    await db_session.execute(
        delete(OrganizationMember).where(OrganizationMember.organization_id == env.org_id)
    )
    await db_session.execute(delete(Organization).where(Organization.id == env.org_id))
    await db_session.execute(
        delete(User).where(User.id.in_([env.owner_id, env.outsider_id]))
    )
    await db_session.commit()


@pytest_asyncio.fixture(loop_scope="session")
async def env(session):
    seeded = await _seed(session)
    try:
        yield seeded
    finally:
        await _teardown(session, seeded)


def _operations(session) -> ChatChannelOperations:
    """The search rewrite and the system message are proven elsewhere."""
    return ChatChannelOperations(
        session,
        search_indexer=AsyncMock(),
        call_lifecycle=AsyncMock(),
    )


async def _refresh_row(session, channel_id) -> ChatSearchAclRefresh | None:
    return (
        await session.execute(
            select(ChatSearchAclRefresh).where(ChatSearchAclRefresh.channel_id == channel_id)
        )
    ).scalar_one_or_none()


async def _audit_rows(session, channel_id) -> list[AuditEvent]:
    return list(
        (
            await session.execute(
                select(AuditEvent)
                .where(
                    AuditEvent.resource_id == channel_id,
                    AuditEvent.action == Action.CHAT_CHANNEL_VISIBILITY_CHANGED,
                )
                .order_by(AuditEvent.created_at)
            )
        )
        .scalars()
        .all()
    )


async def test_lock_down_writes_the_type_audit_and_refresh_fact(session, env: NS) -> None:
    ops = _operations(session)

    channel = await ops.change_channel_visibility(
        env.owner_id, env.org_id, env.public_id, ChannelType.PRIVATE
    )

    assert channel.channel_type == ChannelType.PRIVATE
    stored = await session.get(ChatChannel, env.public_id)
    await session.refresh(stored)
    assert stored.channel_type == ChannelType.PRIVATE

    # The refresh row is what makes the search rewrite survive a queue outage.
    row = await _refresh_row(session, env.public_id)
    assert row is not None
    assert row.organization_id == env.org_id

    audit = await _audit_rows(session, env.public_id)
    assert len(audit) == 1
    assert audit[0].details == {"from": "PUBLIC", "to": "PRIVATE"}


async def test_open_up_records_a_refresh_even_though_membership_paths_skip_public(
    session, env: NS
) -> None:
    ops = _operations(session)

    await ops.change_channel_visibility(
        env.owner_id, env.org_id, env.private_id, ChannelType.PUBLIC
    )

    stored = await session.get(ChatChannel, env.private_id)
    await session.refresh(stored)
    assert stored.channel_type == ChannelType.PUBLIC
    assert await _refresh_row(session, env.private_id) is not None


async def test_open_up_cancels_a_pending_access_request(session, env: NS) -> None:
    request = ContentAccessRequest(
        organization_id=env.org_id,
        requester_id=env.outsider_id,
        requested_urn=f"urn:uniffy:content:CHAT:{env.private_id}",
        original_content_type=ContentType.CHAT,
        original_content_id=env.private_id,
        canonical_content_type=ContentType.CHAT,
        canonical_content_id=env.private_id,
    )
    session.add(request)
    await session.commit()

    ops = _operations(session)
    await ops.change_channel_visibility(
        env.owner_id, env.org_id, env.private_id, ChannelType.PUBLIC
    )

    await session.refresh(request)
    assert request.state == ContentAccessRequestState.CANCELED
    assert request.responded_at is not None


async def test_a_non_owner_member_cannot_flip_it(session, env: NS) -> None:
    session.add(
        ChatChannelMember(
            channel_id=env.public_id,
            subject_type=SubjectType.USER,
            subject_id=env.outsider_id,
            user_id=env.outsider_id,
            role=ChannelRole.ADMIN,
        )
    )
    await session.commit()

    ops = _operations(session)
    with pytest.raises(PermissionDeniedError):
        await ops.change_channel_visibility(
            env.outsider_id, env.org_id, env.public_id, ChannelType.PRIVATE
        )

    stored = await session.get(ChatChannel, env.public_id)
    await session.refresh(stored)
    assert stored.channel_type == ChannelType.PUBLIC
    assert await _refresh_row(session, env.public_id) is None


async def test_a_rejected_flip_leaves_no_audit_or_refresh_row(session, env: NS) -> None:
    ops = _operations(session)

    with pytest.raises(ValidationError):
        await ops.change_channel_visibility(
            env.owner_id, env.org_id, env.public_id, ChannelType.PUBLIC
        )

    assert await _audit_rows(session, env.public_id) == []
    assert await _refresh_row(session, env.public_id) is None
