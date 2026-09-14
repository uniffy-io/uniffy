"""PostgreSQL reaction previews and idempotent mutation events."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.chat.channel import ChannelType, ChatChannel, ChatChannelStats
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.models.chat.reaction import ChatReaction
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.types import SubjectType, generate_id
from uniffy.domains.chat.reactions.operations import (
    REACTOR_PREVIEW_LIMIT,
    ChatReactionOperations,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")

BASE_TIME = datetime(2026, 8, 4, 9, 0, tzinfo=UTC)
REACTOR_COUNT = REACTOR_PREVIEW_LIMIT + 4


async def _seed_reactions(db_session: AsyncSession) -> NS:
    suffix = generate_id().hex[:12]

    users = [
        User(
            email=f"irr-{index}-{suffix}@test.local",
            username=f"irr-{index}-{suffix}",
            full_name=f"Reactor {index}",
            hashed_password="x",
        )
        for index in range(REACTOR_COUNT)
    ]
    org = Organization(name=f"irr {suffix}", slug=f"irr-{suffix}")
    db_session.add_all([*users, org])
    await db_session.flush()

    db_session.add_all([
        OrganizationMember(
            user_id=user.id,
            organization_id=org.id,
            role=OrganizationRole.OWNER if index == 0 else OrganizationRole.MEMBER,
        )
        for index, user in enumerate(users)
    ])

    channel = ChatChannel(
        organization_id=org.id,
        owner_id=users[0].id,
        name=f"irr-{suffix}",
        slug=f"irr-{suffix}",
        channel_type=ChannelType.PUBLIC,
    )
    db_session.add(channel)
    await db_session.flush()
    db_session.add_all([
        ChatChannelStats(channel_id=channel.id),
        ChatChannelMember(
            channel_id=channel.id,
            subject_type=SubjectType.USER,
            subject_id=users[0].id,
            user_id=users[0].id,
        ),
    ])

    reacted = ChatMessage(
        channel_id=channel.id,
        sender_id=users[0].id,
        sender_type=SenderType.USER,
        content="ship it?",
        created_at=BASE_TIME,
    )
    quiet = ChatMessage(
        channel_id=channel.id,
        sender_id=users[0].id,
        sender_type=SenderType.USER,
        content="nobody reacted to this",
        created_at=BASE_TIME + timedelta(minutes=1),
    )
    db_session.add_all([reacted, quiet])
    await db_session.flush()

    # Staggered so the aggregate has a real order to preserve, and inserted
    # newest-first so a query that just returns insertion order would fail.
    for index, user in reversed(list(enumerate(users))):
        db_session.add(
            ChatReaction(
                message_id=reacted.id,
                user_id=user.id,
                emoji="fire",
                created_at=BASE_TIME + timedelta(seconds=index),
            )
        )
    db_session.add(
        ChatReaction(
            message_id=reacted.id,
            user_id=users[0].id,
            emoji="eyes",
            created_at=BASE_TIME + timedelta(seconds=1),
        )
    )
    await db_session.commit()

    return NS(
        org_id=org.id,
        channel_id=channel.id,
        message_id=reacted.id,
        quiet_message_id=quiet.id,
        user_ids=[user.id for user in users],
    )


async def _teardown_reactions(db_session: AsyncSession, env: NS) -> None:
    await db_session.rollback()
    await db_session.execute(
        delete(ChatReaction).where(
            ChatReaction.message_id.in_([env.message_id, env.quiet_message_id])
        )
    )
    await db_session.execute(delete(ChatMessage).where(ChatMessage.channel_id == env.channel_id))
    await db_session.execute(
        delete(ChatChannelMember).where(ChatChannelMember.channel_id == env.channel_id)
    )
    await db_session.execute(
        delete(ChatChannelStats).where(ChatChannelStats.channel_id == env.channel_id)
    )
    await db_session.execute(delete(ChatChannel).where(ChatChannel.id == env.channel_id))
    await db_session.execute(
        delete(OrganizationMember).where(OrganizationMember.organization_id == env.org_id)
    )
    await db_session.execute(delete(Organization).where(Organization.id == env.org_id))
    await db_session.execute(delete(User).where(User.id.in_(env.user_ids)))
    await db_session.commit()


@pytest_asyncio.fixture(loop_scope="session")
async def reactions(session):
    seeded = await _seed_reactions(session)
    try:
        yield seeded
    finally:
        await _teardown_reactions(session, seeded)


def _group(groups: list[dict], emoji: str) -> dict:
    return next(group for group in groups if group["emoji"] == emoji)


async def test_reactor_list_is_bounded_while_the_count_stays_whole(session, reactions) -> None:
    ops = ChatReactionOperations(session)

    result = await ops.get_reactions_for_messages([reactions.message_id], reactions.user_ids[0])
    fire = _group(result[reactions.message_id], "fire")

    assert fire["count"] == REACTOR_COUNT
    assert len(fire["user_ids"]) == REACTOR_PREVIEW_LIMIT


async def test_reactors_come_back_oldest_first(session, reactions) -> None:
    ops = ChatReactionOperations(session)

    result = await ops.get_reactions_for_messages([reactions.message_id], reactions.user_ids[0])
    fire = _group(result[reactions.message_id], "fire")

    assert fire["user_ids"] == [str(uid) for uid in reactions.user_ids[:REACTOR_PREVIEW_LIMIT]]


async def test_own_reaction_is_reported_from_outside_the_bound(session, reactions) -> None:
    late_reactor = reactions.user_ids[-1]
    ops = ChatReactionOperations(session)

    result = await ops.get_reactions_for_messages([reactions.message_id], late_reactor)
    fire = _group(result[reactions.message_id], "fire")

    assert str(late_reactor) not in fire["user_ids"]
    assert fire["current_user_reacted"] is True


async def test_emoji_groups_carry_their_own_reactors(session, reactions) -> None:
    ops = ChatReactionOperations(session)

    result = await ops.get_reactions_for_messages([reactions.message_id], reactions.user_ids[1])
    eyes = _group(result[reactions.message_id], "eyes")

    assert eyes["count"] == 1
    assert eyes["user_ids"] == [str(reactions.user_ids[0])]
    assert eyes["current_user_reacted"] is False


async def test_a_message_without_reactions_has_no_entry(session, reactions) -> None:
    ops = ChatReactionOperations(session)

    result = await ops.get_reactions_for_messages(
        [reactions.message_id, reactions.quiet_message_id],
        reactions.user_ids[0],
    )

    assert reactions.quiet_message_id not in result


async def test_duplicate_add_outside_preview_emits_no_event(session, reactions, monkeypatch) -> None:
    ops = ChatReactionOperations(session)
    publish = AsyncMock()
    monkeypatch.setattr(ops, "_publish_reaction_event", publish)
    user_id = reactions.user_ids[-1]

    await ops.add_reaction(
        user_id, reactions.org_id, reactions.channel_id, reactions.message_id, "fire"
    )
    await ops.add_reaction(
        user_id, reactions.org_id, reactions.channel_id, reactions.message_id, "fire"
    )

    publish.assert_not_awaited()
    result = await ops.get_reactions_for_messages([reactions.message_id], user_id)
    assert _group(result[reactions.message_id], "fire")["count"] == REACTOR_COUNT


async def test_only_database_transitions_emit_reaction_events(
    session, reactions, monkeypatch
) -> None:
    ops = ChatReactionOperations(session)
    publish = AsyncMock()
    monkeypatch.setattr(ops, "_publish_reaction_event", publish)
    monkeypatch.setattr(
        ops, "_get_channel_member_ids", AsyncMock(return_value=[reactions.user_ids[0]])
    )
    user_id = reactions.user_ids[0]
    args = (user_id, reactions.org_id, reactions.channel_id, reactions.quiet_message_id, "fire")

    await ops.add_reaction(*args)
    await ops.add_reaction(*args)
    result = await ops.get_reactions_for_messages([reactions.quiet_message_id], user_id)
    assert _group(result[reactions.quiet_message_id], "fire")["count"] == 1
    assert publish.await_count == 1
    assert publish.await_args.kwargs["added"] is True

    await ops.remove_reaction(*args)
    await ops.remove_reaction(*args)
    assert publish.await_count == 2
    assert publish.await_args.kwargs["added"] is False
    assert await ops.get_reactions_for_messages([reactions.quiet_message_id], user_id) == {}
