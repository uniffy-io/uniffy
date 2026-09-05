from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from uniffy_proto.agents.v1.sessions_pb2 import ListMessagesRequest
from uniffy_proto.chat.v1.chat_pb2 import GetThreadMessagesRequest

import uniffy.core.models  # noqa: F401
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.message import AgentMessage, AgentMessageRole
from uniffy.core.models.agents.run_log import AgentRunLog
from uniffy.core.models.agents.session import AgentSession, AgentSessionKind
from uniffy.core.models.agents.skill import AgentSkill, AgentSkillSource, SkillSurface
from uniffy.core.models.agents.skill_draft import AgentSkillDraft, AgentSkillDraftKind
from uniffy.core.models.agents.skill_invocation import AgentSkillInvocation
from uniffy.core.models.agents.skill_version import AgentSkillVersion
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.models.chat.reaction import ChatReaction
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.types import generate_id
from uniffy.domains.agents.sessions import handlers as sessions
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.chat.messages import handlers as messages
from uniffy.domains.chat.threads import handlers as threads
from uniffy.infrastructure.database.session import ALEMBIC_INI_PATH, get_database_url
from uniffy.tests.integration.internal.migrations.test_migration_run import (
    _migrate_to,
    _provision_to,
    _query,
)


async def test_rating_removal_preserves_content_and_history(scratch_database, monkeypatch):
    await _provision_to(scratch_database, "102")
    engine = create_async_engine(get_database_url())
    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            org = Organization(name="History", slug="history")
            user = User(username="reader", email="reader@example.test")
            session.add_all([org, user])
            await session.flush()
            agent = Agent(organization_id=org.id, owner_id=user.id, name="Assistant")
            skill = AgentSkill(
                organization_id=org.id,
                source=AgentSkillSource.ORGANIZATION,
                name="summary",
                display_name="Summary",
                content="Summarize the conversation.",
            )
            channel = ChatChannel(
                organization_id=org.id,
                owner_id=user.id,
                name="History",
                slug="history",
                channel_type=ChannelType.PUBLIC,
            )
            session.add_all([
                agent,
                skill,
                channel,
                OrganizationMember(
                    organization_id=org.id, user_id=user.id, role=OrganizationRole.ADMIN
                ),
            ])
            await session.flush()
            conversation = AgentSession(
                organization_id=org.id,
                agent_id=agent.id,
                user_id=user.id,
                kind=AgentSessionKind.DIRECT,
            )
            version = AgentSkillVersion(
                skill_id=skill.id,
                version_number=1,
                name=skill.name,
                display_name=skill.display_name,
                content=skill.content,
            )
            root = ChatMessage(
                channel_id=channel.id,
                sender_id=user.id,
                sender_type=SenderType.USER,
                content="Please summarize.",
            )
            session.add_all([conversation, version, root])
            await session.flush()
            reply = AgentMessage(
                session_id=conversation.id,
                role=AgentMessageRole.ASSISTANT,
                content="Session answer",
                thinking=[{"content": "Reasoning"}],
            )
            chat_reply = ChatMessage(
                channel_id=channel.id,
                sender_id=agent.id,
                sender_type=SenderType.AGENT,
                root_id=root.id,
                content="Thread answer",
            )
            run = AgentRunLog(
                organization_id=org.id,
                agent_id=agent.id,
                user_id=user.id,
                session_id=conversation.id,
                model="fixture",
            )
            session.add_all([reply, chat_reply, run])
            await session.flush()
            session.add_all([
                AgentSkillInvocation(
                    organization_id=org.id,
                    user_id=user.id,
                    agent_id=agent.id,
                    skill_id=skill.id,
                    skill_version_id=version.id,
                    skill_version_number=1,
                    surface=SkillSurface.SESSION,
                    session_id=conversation.id,
                    run_log_id=run.id,
                    response_message_id=reply.id,
                ),
                AgentSkillDraft(
                    organization_id=org.id,
                    owner_id=user.id,
                    kind=AgentSkillDraftKind.EDIT,
                    target_skill_id=skill.id,
                    content="Draft body",
                    evidence_message_ids=[str(reply.id)],
                ),
                ChatReaction(message_id=chat_reply.id, user_id=user.id, emoji="ack"),
            ])
            for target, message_id in (
                ("agents_message_id", reply.id),
                ("chat_message_id", chat_reply.id),
            ):
                await session.execute(
                    text(
                        f"INSERT INTO agents_message_feedback (id, {target}, user_id, rating, "
                        "comment, created_at) VALUES (:id, :message, :user, 'down', :comment, now())"
                    ),
                    {
                        "id": generate_id(),
                        "message": message_id,
                        "user": user.id,
                        "comment": "A dedicated rating",
                    },
                )
            await session.commit()

            tables = (
                "agents_agents",
                "agents_sessions",
                "agents_messages",
                "agents_skills",
                "agents_skill_versions",
                "agents_skill_drafts",
                "agents_skill_invocations",
                "agents_run_logs",
                "chat_channels",
                "chat_messages",
                "chat_reactions",
            )
            before = {table: _query(f"SELECT * FROM {table}") for table in tables}
            assert _query("SELECT count(*) FROM agents_message_feedback") == [(2,)]
            _migrate_to("103")
            assert _query("SELECT to_regclass('agents_message_feedback')") == [(None,)]
            assert {table: _query(f"SELECT * FROM {table}") for table in tables} == before

            @asynccontextmanager
            async def open_history():
                async with AsyncSession(engine) as history:
                    yield history

            for module in (sessions, threads):
                monkeypatch.setattr(module, "open_session", open_history)
                monkeypatch.setattr(module, "current_user_id", lambda: user.id)
                monkeypatch.setattr(module, "resolve_organization_id", lambda _: org.id)
            sender = SimpleNamespace(
                resolve_many=AsyncMock(
                    return_value={
                        agent.id: SimpleNamespace(display_name="Assistant", avatar_url=None)
                    }
                )
            )
            for module in (messages, threads):
                monkeypatch.setattr(module, "SenderResolver", lambda _: sender)

            history = await sessions.SessionsHandlers().list_messages(
                ListMessagesRequest(organization_id=str(org.id), session_id=str(conversation.id)),
                None,
            )
            assert [message.content for message in history.messages] == ["Session answer"]
            assert "Reasoning" in history.messages[0].thinking_json
            thread = await threads.ThreadHandlers().get_thread_messages(
                GetThreadMessagesRequest(
                    organization_id=str(org.id),
                    channel_id=str(channel.id),
                    root_message_id=str(root.id),
                ),
                None,
            )
            assert [message.content for message in thread.messages] == ["Thread answer"]
            enriched = await messages.MessageHandlers._enrich_messages(
                None,
                session,
                [chat_reply],
                user.id,
                org.id,
                ChatAccessChecker(session),
            )
            assert enriched[0].content == "Thread answer"
            assert enriched[0].reactions[0].emoji == "ack"
            assert enriched[0].reactions[0].count == 1
            assert enriched[0].reactions[0].current_user_reacted
            await session.rollback()

            config = Config(str(ALEMBIC_INI_PATH))
            config.attributes["configure_logger"] = False
            command.downgrade(config, "102")
            assert _query("SELECT count(*) FROM agents_message_feedback") == [(0,)]
            assert {table: _query(f"SELECT * FROM {table}") for table in tables} == before
            _migrate_to("103")
            assert _query("SELECT to_regclass('agents_message_feedback')") == [(None,)]
    finally:
        await engine.dispose()
