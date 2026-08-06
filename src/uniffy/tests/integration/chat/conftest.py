"""A channel with two live threads, for the queries that decide what an agent reads.

Branch separation is a question about which rows come back, so it is asserted
against the real engine rather than the text of a query: the window is built
from three selects whose interaction (root, its replies, the lead-in that
stops at the root) only exists in Postgres.
"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace as NS

import pytest
import pytest_asyncio
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.chat.channel import ChannelType, ChatChannel, ChatChannelStats
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.models.chat.thread import ChatThread, ChatThreadParticipant, ChatThreadStats
from uniffy.core.models.chat.thread_follow import ChatThreadFollow
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.types import SubjectType, generate_id
from uniffy.db import close_db, init_db, open_session
from uniffy.db.session import get_database_url

BASE_TIME = datetime(2026, 8, 4, 9, 0, tzinfo=UTC)


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def database():
    """Bring up the real engine once, or skip the suite when nothing answers."""
    try:
        await init_db(skip_migrations=True)
    except Exception as exc:
        pytest.skip(f"no database at {get_database_url()}: {exc}")
    try:
        yield
    finally:
        await close_db()


@pytest_asyncio.fixture(loop_scope="session")
async def session(database):
    async with open_session() as db_session:
        yield db_session


async def _seed_threads(db_session: AsyncSession) -> NS:
    suffix = generate_id().hex[:12]

    user = User(
        email=f"itc-user-{suffix}@test.local",
        username=f"itc-user-{suffix}",
        full_name="Thread Tester",
        hashed_password="x",
    )
    org = Organization(name=f"itc {suffix}", slug=f"itc-{suffix}")
    db_session.add_all([user, org])
    await db_session.flush()

    db_session.add(
        OrganizationMember(
            user_id=user.id,
            organization_id=org.id,
            role=OrganizationRole.OWNER,
        )
    )

    agent = Agent(
        organization_id=org.id,
        owner_id=user.id,
        name=f"Scribe {suffix}",
        soul_prompt="",
        primary_model="claude-opus-5",
    )
    db_session.add(agent)
    await db_session.flush()

    channel = ChatChannel(
        organization_id=org.id,
        owner_id=user.id,
        name=f"itc-{suffix}",
        slug=f"itc-{suffix}",
        channel_type=ChannelType.PUBLIC,
    )
    db_session.add(channel)
    await db_session.flush()
    db_session.add_all([
        ChatChannelStats(channel_id=channel.id),
        ChatChannelMember(
            channel_id=channel.id,
            subject_type=SubjectType.USER,
            subject_id=user.id,
            user_id=user.id,
        ),
        ChatChannelMember(
            channel_id=channel.id,
            subject_type=SubjectType.AGENT,
            subject_id=agent.id,
        ),
    ])

    def _msg(minute: int, content: str, *, sender="user", root=None) -> ChatMessage:
        is_agent = sender == "agent"
        return ChatMessage(
            channel_id=channel.id,
            sender_id=agent.id if is_agent else user.id,
            sender_type=SenderType.AGENT if is_agent else SenderType.USER,
            content=content,
            root_id=root,
            message_metadata={"kind": "final"} if is_agent else None,
            created_at=BASE_TIME + timedelta(minutes=minute),
        )

    channel_first = _msg(0, "channel first")
    channel_second = _msg(1, "channel second")
    root_a = _msg(2, "topic A", sender="agent")
    root_b = _msg(3, "topic B")
    db_session.add_all([channel_first, channel_second, root_a, root_b])
    await db_session.flush()

    reply_a_user = _msg(4, "about A", root=root_a.id)
    reply_a_agent = _msg(5, "answer in A", sender="agent", root=root_a.id)
    reply_b_user = _msg(6, "about B", root=root_b.id)
    channel_last = _msg(7, "channel after threads")
    db_session.add_all([reply_a_user, reply_a_agent, reply_b_user, channel_last])

    db_session.add(ChatThread(root_message_id=root_a.id, channel_id=channel.id))
    db_session.add(
        ChatThreadStats(root_message_id=root_a.id, reply_count=2, last_reply_at=BASE_TIME)
    )
    await db_session.commit()

    return NS(
        org_id=org.id,
        user_id=user.id,
        agent_id=agent.id,
        channel_id=channel.id,
        channel_first_id=channel_first.id,
        channel_second_id=channel_second.id,
        root_a_id=root_a.id,
        root_b_id=root_b.id,
        reply_a_user_id=reply_a_user.id,
        reply_a_agent_id=reply_a_agent.id,
        reply_b_user_id=reply_b_user.id,
        channel_last_id=channel_last.id,
    )


async def _teardown_threads(db_session: AsyncSession, env: NS) -> None:
    await db_session.rollback()
    await db_session.execute(delete(ChatThreadFollow).where(ChatThreadFollow.root_message_id.in_(
        [env.root_a_id, env.root_b_id]
    )))
    await db_session.execute(delete(ChatThreadParticipant).where(
        ChatThreadParticipant.root_message_id.in_([env.root_a_id, env.root_b_id])
    ))
    await db_session.execute(delete(ChatThreadStats).where(
        ChatThreadStats.root_message_id.in_([env.root_a_id, env.root_b_id])
    ))
    await db_session.execute(delete(ChatThread).where(
        ChatThread.root_message_id.in_([env.root_a_id, env.root_b_id])
    ))
    await db_session.execute(delete(ChatMessage).where(ChatMessage.channel_id == env.channel_id))
    await db_session.execute(
        delete(ChatChannelMember).where(ChatChannelMember.channel_id == env.channel_id)
    )
    await db_session.execute(
        delete(ChatChannelStats).where(ChatChannelStats.channel_id == env.channel_id)
    )
    await db_session.execute(delete(ChatChannel).where(ChatChannel.id == env.channel_id))
    await db_session.execute(delete(Agent).where(Agent.id == env.agent_id))
    await db_session.execute(
        delete(OrganizationMember).where(OrganizationMember.organization_id == env.org_id)
    )
    await db_session.execute(delete(Organization).where(Organization.id == env.org_id))
    await db_session.execute(delete(User).where(User.id == env.user_id))
    await db_session.commit()


@pytest_asyncio.fixture(loop_scope="session")
async def threads(session):
    seeded = await _seed_threads(session)
    try:
        yield seeded
    finally:
        await _teardown_threads(session, seeded)
