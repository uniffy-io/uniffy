from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.cron_task import AgentCronTask  # noqa: F401
from uniffy.core.models.agents.message import AgentMessage, AgentMessageRole
from uniffy.core.models.agents.run_log import AgentRunLog
from uniffy.core.models.agents.session import AgentSession, AgentSessionKind
from uniffy.core.models.agents.skill import AgentSkill, AgentSkillSource, SkillSurface
from uniffy.core.models.agents.skill_invocation import AgentSkillInvocation, SkillInvocationStatus
from uniffy.core.models.agents.skill_version import AgentSkillVersion
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.models.permissions.domain_admin import DomainAdmin
from uniffy.core.types import DomainType, generate_id
from uniffy.domains.agents.skills.metrics import SkillMetricsReader
from uniffy.infrastructure.database.session import get_database_url
from uniffy.tests.integration.internal.migrations.test_migration_run import _provision_to


async def test_skill_metrics_exact_versions_scope_and_bounded_pages(scratch_database):
    await _provision_to(scratch_database, "103")
    engine = create_async_engine(get_database_url())
    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            org = Organization(name="Metrics", slug="metrics")
            other = Organization(name="Other", slug="other")
            admin = User(username="admin", email="admin@example.test")
            member = User(username="member", email="member@example.test")
            session.add_all([org, other, admin, member])
            await session.flush()
            membership = OrganizationMember(
                organization_id=org.id, user_id=admin.id, role=OrganizationRole.ADMIN
            )
            session.add_all([
                membership,
                OrganizationMember(organization_id=org.id, user_id=member.id),
            ])
            agent = Agent(organization_id=org.id, owner_id=admin.id, name="Metrics agent")
            skill = AgentSkill(
                organization_id=org.id,
                source=AgentSkillSource.ORGANIZATION,
                name="report",
                display_name="Head name",
                content="Private body",
            )
            session.add_all([agent, skill])
            await session.flush()
            versions = [
                AgentSkillVersion(
                    skill_id=skill.id,
                    version_number=n,
                    name="report",
                    display_name=f"Snapshot {n}",
                    content="Private snapshot",
                )
                for n in (1, 2)
            ]
            conversation = AgentSession(
                organization_id=org.id,
                user_id=admin.id,
                agent_id=agent.id,
                kind=AgentSessionKind.DIRECT,
            )
            channel = ChatChannel(
                organization_id=org.id,
                owner_id=admin.id,
                name="Chat",
                slug="chat",
                channel_type=ChannelType.PRIVATE,
            )
            foreign_channel = ChatChannel(
                organization_id=other.id,
                owner_id=admin.id,
                name="Foreign",
                slug="foreign",
                channel_type=ChannelType.PRIVATE,
            )
            session.add_all([*versions, conversation, channel, foreign_channel])
            await session.flush()
            reply = AgentMessage(session_id=conversation.id, role=AgentMessageRole.ASSISTANT)
            chat_reply = ChatMessage(
                channel_id=channel.id,
                sender_id=agent.id,
                sender_type=SenderType.AGENT,
                content="Private chat",
            )
            foreign_reply = ChatMessage(
                channel_id=foreign_channel.id,
                sender_id=agent.id,
                sender_type=SenderType.AGENT,
                content="Foreign chat",
            )
            session.add_all([reply, chat_reply, foreign_reply])
            await session.flush()
            now = datetime.now(UTC)

            def observation(version=versions[0], **overrides):
                return AgentSkillInvocation(**{
                    "organization_id": org.id,
                    "user_id": admin.id,
                    "agent_id": agent.id,
                    "skill_id": skill.id,
                    "skill_version_id": version.id,
                    "skill_version_number": version.version_number,
                    "surface": SkillSurface.SESSION,
                    "session_id": conversation.id,
                    "status": SkillInvocationStatus.COMPLETED,
                    "completed_at": now,
                    **overrides,
                })

            run = AgentRunLog(
                organization_id=org.id,
                user_id=admin.id,
                agent_id=agent.id,
                channel_id=channel.id,
                model="fixture",
                duration_ms=120,
                input_tokens=100,
                output_tokens=20,
                cost=Decimal("0.2"),
                cost_currency="USD",
            )
            euro_run = AgentRunLog(
                organization_id=org.id,
                user_id=admin.id,
                agent_id=agent.id,
                session_id=conversation.id,
                model="fixture",
                cost=Decimal("0.3"),
                cost_currency="EUR",
            )
            session.add_all([
                run,
                euro_run,
                observation(response_message_id=reply.id, run_log_id=euro_run.id),
                observation(
                    surface=SkillSurface.CHAT,
                    session_id=None,
                    channel_id=channel.id,
                    response_message_id=chat_reply.id,
                    run_log_id=run.id,
                    tool_error_count=2,
                ),
                observation(status=SkillInvocationStatus.FAILED),
                observation(versions[1], user_id=member.id),
                observation(versions[1], status=SkillInvocationStatus.STARTED, completed_at=None),
                observation(versions[1], status=SkillInvocationStatus.REJECTED),
                observation(versions[1], status=SkillInvocationStatus.CANCELLED),
                observation(organization_id=other.id),
                observation(created_at=now - timedelta(days=100)),
                # A corrupt historical correlation must not import another destination's spend.
                observation(
                    versions[1],
                    surface=SkillSurface.CHAT,
                    session_id=None,
                    channel_id=foreign_channel.id,
                    response_message_id=foreign_reply.id,
                    run_log_id=run.id,
                ),
            ])
            await session.commit()
            reader = SkillMetricsReader(session)
            args = {"user_id": admin.id, "organization_id": org.id}
            page = await reader.read(**args)
            assert len(page.metrics) == 2
            first, second = page.metrics
            assert first["display_name"] == "Snapshot 1"
            assert first["invocation_count"] == 3
            assert first["completed_count"] == 2 and first["failed_count"] == 1
            assert first["tool_error_run_count"] == 1 and first["tool_error_rate"] == pytest.approx(
                1 / 3
            )
            assert first["run_log_count"] == 2 and first["duration_ms"] == 120
            assert first["input_tokens"] == 100 and first["output_tokens"] == 20
            assert first["costs"] == [
                {"currency": "EUR", "amount": "0.300000", "run_count": 1},
                {"currency": "USD", "amount": "0.200000", "run_count": 1},
            ]
            assert second["invocation_count"] == 5 and second["unique_users"] == 2
            assert second["completed_count"] == 2
            assert (
                second["started_count"] == second["rejected_count"] == second["cancelled_count"] == 1
            )
            assert second["failed_count"] == second["tool_error_run_count"] == 0
            assert second["run_log_count"] == 0
            assert second["costs"] == []
            assert "Private" not in str(page.metrics) and "Foreign" not in str(page.metrics)
            one = await reader.read(**args, page_size=1)
            two = await reader.read(**args, page_size=1, cursor=one.next_cursor)
            assert one.metrics + two.metrics == page.metrics
            assert two.next_cursor == "" and one.window_end == two.window_end
            for options in (
                {"window_days": 91},
                {"page_size": 501},
                {"cursor": "bad"},
                {"cursor": one.next_cursor, "window_days": 1},
            ):
                with pytest.raises(ValidationError):
                    await reader.read(**args, **options)
            for skill_filter in (None, skill.id):
                with pytest.raises(PermissionDeniedError):
                    await reader.read(
                        user_id=member.id, organization_id=org.id, skill_id=skill_filter
                    )
            assert (await reader.read(**args, skill_id=skill.id)).metrics == page.metrics
            session.add(
                DomainAdmin(
                    user_id=member.id,
                    organization_id=org.id,
                    domain=DomainType.AGENTS,
                    granted_by=admin.id,
                )
            )
            await session.commit()
            assert (
                await reader.read(user_id=member.id, organization_id=org.id, skill_id=skill.id)
            ).metrics == page.metrics
            with pytest.raises(PermissionDeniedError):
                await reader.read(user_id=member.id, organization_id=org.id)
            assert (await reader.read(**args, skill_id=generate_id())).metrics == []
            await session.delete(skill)
            await session.commit()
            history = await reader.read(**args)
            assert [row["display_name"] for row in history.metrics] == ["Deleted skill"] * 2
            assert [row["invocation_count"] for row in history.metrics] == [3, 5]
            membership.is_active = False
            await session.commit()
            with pytest.raises(PermissionDeniedError):
                await reader.read(**args)
            assert await session.scalar(text("SELECT to_regclass('agents_skill_usages')")) is None
            assert (
                await session.scalar(text("SELECT to_regclass('agents_message_feedback')")) is None
            )
    finally:
        await engine.dispose()
