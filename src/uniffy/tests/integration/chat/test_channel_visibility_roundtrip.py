"""Flip a channel's visibility against real Postgres, both directions.

The unit tests prove which patch the job builds. These prove the rows that
survive a real transaction: the channel type, the audit row that has to commit
with it, the durable refresh fact the search rewrite depends on, and the pending
access request an open-up makes moot.
"""

import asyncio
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from uniffy.core.audit.actions import Action
from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.chat.channel import ChannelType, ChatChannel, ChatChannelStats
from uniffy.core.models.chat.channel_member import ChannelRole, ChatChannelMember
from uniffy.core.models.chat.search_acl_refresh import ChatSearchAclRefresh
from uniffy.core.models.files.file import File
from uniffy.core.models.files.folder import Folder
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.models.permissions.content_access_request import (
    ContentAccessRequest,
    ContentAccessRequestState,
)
from uniffy.core.types import ContentType, SubjectType, generate_id
from uniffy.domains.chat.channels import updates
from uniffy.domains.chat.channels.operations import ChatChannelOperations
from uniffy.domains.permissions.requests.dismissal import stage_dismiss_pending_requests
from uniffy.infrastructure.database.session import get_database_url

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
        update(File)
        .where(File.organization_id == env.org_id)
        .values(
            current_version_id=None,
        )
    )
    await db_session.execute(delete(File).where(File.organization_id == env.org_id))
    await db_session.execute(delete(Folder).where(Folder.organization_id == env.org_id))
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
    await db_session.execute(delete(User).where(User.id.in_([env.owner_id, env.outsider_id])))
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

    await ops.change_channel_visibility(env.owner_id, env.org_id, env.private_id, ChannelType.PUBLIC)

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
    await ops.change_channel_visibility(env.owner_id, env.org_id, env.private_id, ChannelType.PUBLIC)

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


@pytest.mark.parametrize(
    "terminal",
    [
        ContentAccessRequestState.APPROVED,
        ContentAccessRequestState.DENIED,
        ContentAccessRequestState.CANCELED,
    ],
)
async def test_visibility_dismissal_preserves_an_in_flight_terminal_decision(session, env, terminal):
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
    engine = create_async_engine(get_database_url())
    try:
        async with AsyncSession(engine, expire_on_commit=False) as deciding:
            decided = (
                await deciding.execute(
                    select(ContentAccessRequest)
                    .where(
                        ContentAccessRequest.id == request.id,
                    )
                    .with_for_update()
                )
            ).scalar_one()
            decided.state = terminal
            decided.responded_by_user_id = env.owner_id
            decided.decision_note = "Decision is final"
            await deciding.flush()

            async def dismiss():
                rows = await stage_dismiss_pending_requests(
                    session,
                    organization_id=env.org_id,
                    content_type=ContentType.CHAT,
                    content_id=env.private_id,
                )
                await session.commit()
                return rows

            pending = asyncio.create_task(dismiss())
            with pytest.raises(TimeoutError):
                await asyncio.wait_for(asyncio.shield(pending), 0.1)
            await deciding.commit()
            assert await asyncio.wait_for(pending, 5) == []
        await session.refresh(request)
        assert request.state == terminal
        assert request.responded_by_user_id == env.owner_id
        assert request.decision_note == decided.decision_note
    finally:
        await engine.dispose()


async def test_a_join_waits_for_an_in_flight_lock_down(session, env: NS, monkeypatch) -> None:
    locked, release = asyncio.Event(), asyncio.Event()
    write_audit = updates.write_audit_event

    async def pause_flip(*args, **kwargs):
        await write_audit(*args, **kwargs)
        locked.set()
        await release.wait()

    monkeypatch.setattr(updates, "write_audit_event", pause_flip)
    flipping = _operations(session)
    flipping._claim_visibility_refresh = AsyncMock(return_value=False)
    flipping._post_actor_system_message = AsyncMock()
    flipping._refresh_channel_live_state = AsyncMock()
    flipping._publish_channel_updated = AsyncMock()
    flip = asyncio.create_task(
        flipping.change_channel_visibility(
            env.owner_id, env.org_id, env.public_id, ChannelType.PRIVATE
        )
    )
    engine = create_async_engine(get_database_url())
    try:
        await asyncio.wait_for(locked.wait(), 5)
        async with AsyncSession(engine, expire_on_commit=False) as joining:
            joiner = _operations(joining)
            joiner._publish_member_event = AsyncMock()
            joiner._post_join_system_message = AsyncMock()
            joiner._refresh_channel_live_state = AsyncMock()
            join = asyncio.create_task(
                joiner.join_channel(env.outsider_id, env.org_id, env.public_id)
            )
            # The gate cannot read the type until the lock-down has committed.
            with pytest.raises(TimeoutError):
                await asyncio.wait_for(asyncio.shield(join), 0.2)
            release.set()
            await asyncio.wait_for(flip, 5)
            with pytest.raises(PermissionDeniedError):
                await asyncio.wait_for(join, 5)
        member = (
            await session.execute(
                select(ChatChannelMember).where(
                    ChatChannelMember.channel_id == env.public_id,
                    ChatChannelMember.user_id == env.outsider_id,
                )
            )
        ).scalar_one_or_none()
        assert member is None
    finally:
        release.set()
        await engine.dispose()

