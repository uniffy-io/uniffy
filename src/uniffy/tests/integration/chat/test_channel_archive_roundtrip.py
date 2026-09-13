"""Archive and restore a channel, and prove which list each state lands in.

The sidebar's two views are one query separated by a boolean, so the split is
asserted on the rows Postgres returns rather than on the shape of the filter.
"""

from types import SimpleNamespace as NS
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.chat.channel import ChannelType, ChatChannel, ChatChannelStats
from uniffy.core.models.chat.channel_member import ChannelRole, ChatChannelMember
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.types import SubjectType, generate_id
from uniffy.domains.chat.channels.operations import ChatChannelOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _seed_channels(db_session: AsyncSession) -> NS:
    suffix = generate_id().hex[:12]

    owner = User(
        email=f"ica-{suffix}@test.local",
        username=f"ica-{suffix}",
        full_name="Channel Owner",
        hashed_password="x",
    )
    org = Organization(name=f"ica {suffix}", slug=f"ica-{suffix}")
    other_org = Organization(name=f"ica-other {suffix}", slug=f"ica-other-{suffix}")
    db_session.add_all([owner, org, other_org])
    await db_session.flush()

    db_session.add_all([
        OrganizationMember(
            user_id=owner.id, organization_id=org.id, role=OrganizationRole.MEMBER
        ),
        OrganizationMember(
            user_id=owner.id, organization_id=other_org.id, role=OrganizationRole.MEMBER
        ),
    ])

    channels = []
    for name in ("paused-project", "still-running"):
        channel = ChatChannel(
            organization_id=org.id,
            owner_id=owner.id,
            name=f"{name}-{suffix}",
            slug=f"{name}-{suffix}",
            channel_type=ChannelType.PRIVATE,
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
        channels.append(channel)
    await db_session.commit()

    return NS(
        org_id=org.id,
        other_org_id=other_org.id,
        owner_id=owner.id,
        paused_id=channels[0].id,
        running_id=channels[1].id,
        channel_ids=[channel.id for channel in channels],
    )


async def _teardown_channels(db_session: AsyncSession, env: NS) -> None:
    await db_session.rollback()
    # audit_events is append-only at the database level and carries no FK to the
    # organization, so the rows this suite writes outlive its fixtures by design.
    await db_session.execute(
        delete(ChatChannelMember).where(ChatChannelMember.channel_id.in_(env.channel_ids))
    )
    await db_session.execute(
        delete(ChatChannelStats).where(ChatChannelStats.channel_id.in_(env.channel_ids))
    )
    await db_session.execute(delete(ChatChannel).where(ChatChannel.id.in_(env.channel_ids)))
    await db_session.execute(
        delete(OrganizationMember).where(
            OrganizationMember.organization_id.in_([env.org_id, env.other_org_id])
        )
    )
    await db_session.execute(
        delete(Organization).where(Organization.id.in_([env.org_id, env.other_org_id]))
    )
    await db_session.execute(delete(User).where(User.id == env.owner_id))
    await db_session.commit()


@pytest_asyncio.fixture(loop_scope="session")
async def channels(session):
    seeded = await _seed_channels(session)
    try:
        yield seeded
    finally:
        await _teardown_channels(session, seeded)


def _operations(session) -> ChatChannelOperations:
    """Archive ends calls and drops search docs; neither is what these rows prove."""
    search = AsyncMock()
    call_lifecycle = AsyncMock()
    return ChatChannelOperations(
        session,
        search_indexer=search,
        call_lifecycle=call_lifecycle,
    )


async def _list_ids(ops: ChatChannelOperations, env: NS, *, archived_only: bool) -> set:
    rows, _ = await ops.list_user_channels(
        env.owner_id,
        env.org_id,
        archived_only=archived_only,
    )
    return {channel.id for channel, _stats, _role, _folder in rows}


async def test_archive_moves_a_channel_between_the_two_lists(session, channels) -> None:
    ops = _operations(session)

    assert await _list_ids(ops, channels, archived_only=False) == set(channels.channel_ids)
    assert await _list_ids(ops, channels, archived_only=True) == set()

    await ops.archive_channel(channels.owner_id, channels.org_id, channels.paused_id)

    assert await _list_ids(ops, channels, archived_only=False) == {channels.running_id}
    assert await _list_ids(ops, channels, archived_only=True) == {channels.paused_id}


async def test_unarchive_brings_it_back_with_an_audit_row(session, channels) -> None:
    ops = _operations(session)
    await ops.archive_channel(channels.owner_id, channels.org_id, channels.paused_id)

    restored = await ops.unarchive_channel(
        channels.owner_id, channels.org_id, channels.paused_id
    )

    assert restored.is_archived is False
    assert await _list_ids(ops, channels, archived_only=False) == set(channels.channel_ids)
    assert await _list_ids(ops, channels, archived_only=True) == set()

    actions = (
        await session.execute(
            select(AuditEvent.action).where(AuditEvent.resource_id == channels.paused_id)
        )
    ).scalars().all()
    assert Action.CHAT_CHANNEL_UNARCHIVED in actions


async def test_restoring_a_live_channel_is_refused(session, channels) -> None:
    ops = _operations(session)

    with pytest.raises(ValidationError):
        await ops.unarchive_channel(channels.owner_id, channels.org_id, channels.running_id)


async def test_a_channel_in_another_org_is_not_found(session, channels) -> None:
    ops = _operations(session)
    await ops.archive_channel(channels.owner_id, channels.org_id, channels.paused_id)

    with pytest.raises(NotFoundError):
        await ops.unarchive_channel(
            channels.owner_id, channels.other_org_id, channels.paused_id
        )


async def test_a_deleted_channel_is_not_found(session, channels) -> None:
    ops = _operations(session)
    await ops.archive_channel(channels.owner_id, channels.org_id, channels.paused_id)
    await ops.delete_channel(channels.owner_id, channels.org_id, channels.paused_id)

    with pytest.raises(NotFoundError):
        await ops.unarchive_channel(channels.owner_id, channels.org_id, channels.paused_id)
