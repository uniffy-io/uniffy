"""Agent creation transactions against PostgreSQL."""

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import delete, func, select, text

from uniffy.core.audit.actions import Action
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.login.group import Group
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.tags.tag import Tag, TagAssignment
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import AccessMode, ContentType, SubjectType, generate_id
from uniffy.db import open_session
from uniffy.domains.agents.agents.operations import AgentOperations
from uniffy.domains.permissions.members import ContentMembersOperations
from uniffy.domains.tags.operations import TagOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _seed_group_and_tag(session, env):
    suffix = generate_id().hex[:10]
    group = Group(
        organization_id=env.org_id,
        name=f"agent transaction {suffix}",
        slug=f"agent-transaction-{suffix}",
        created_by_user_id=env.admin_id,
    )
    tag = Tag(
        organization_id=env.org_id,
        name=f"Agent transaction {suffix}",
        slug=f"agent-transaction-{suffix}",
        created_by=env.admin_id,
    )
    session.add_all([group, tag])
    await session.commit()
    return group.id, tag.id


async def _cleanup(session, env, group_id, tag_id, agent_id=None) -> None:
    await session.rollback()
    if agent_id is not None:
        await session.execute(
            delete(TagAssignment).where(
                TagAssignment.content_urn == build_content_urn(ContentType.AGENT, agent_id)
            )
        )
        await session.execute(
            delete(ContentMember).where(
                ContentMember.organization_id == env.org_id,
                ContentMember.content_type == ContentType.AGENT,
                ContentMember.content_id == agent_id,
            )
        )
        await session.execute(delete(Agent).where(Agent.id == agent_id))
        await session.execute(text("SET LOCAL uniffy.audit_maintenance = 'on'"))
        await session.execute(delete(AuditEvent).where(AuditEvent.resource_id == agent_id))
    await session.execute(delete(Group).where(Group.id == group_id))
    await session.execute(delete(Tag).where(Tag.id == tag_id))
    await session.commit()


async def _audit_count(session, organization_id) -> int:
    return int(
        (
            await session.execute(
                select(func.count())
                .select_from(AuditEvent)
                .where(AuditEvent.organization_id == organization_id)
            )
        ).scalar_one()
    )


async def test_agent_create_rolls_back_row_sharing_tags_and_member_audit(
    session,
    env,
) -> None:
    group_id, tag_id = await _seed_group_and_tag(session, env)
    name = f"Rollback agent {generate_id().hex[:10]}"
    audit_count_before = await _audit_count(session, env.org_id)

    try:
        with (
            patch(
                "uniffy.domains.agents.agents.operations.write_audit_event",
                new=AsyncMock(side_effect=RuntimeError("agent audit unavailable")),
            ),
            pytest.raises(RuntimeError, match="agent audit unavailable"),
        ):
            await AgentOperations(session).create_agent(
                user_id=env.admin_id,
                organization_id=env.org_id,
                name=name,
                access_mode=AccessMode.EXPLICIT_MEMBERS,
                group_ids=[group_id],
                tag_ids=[tag_id],
            )

        async with open_session() as isolated:
            agent_count = await isolated.scalar(
                select(func.count()).select_from(Agent).where(Agent.name == name)
            )
            member_count = await isolated.scalar(
                select(func.count())
                .select_from(ContentMember)
                .where(
                    ContentMember.organization_id == env.org_id,
                    ContentMember.content_type == ContentType.AGENT,
                    ContentMember.subject_type == SubjectType.GROUP,
                    ContentMember.subject_id == group_id,
                )
            )
            tag_count = await isolated.scalar(
                select(func.count()).select_from(TagAssignment).where(TagAssignment.tag_id == tag_id)
            )
            audit_count_after = await _audit_count(isolated, env.org_id)

        assert agent_count == 0
        assert member_count == 0
        assert tag_count == 0
        assert audit_count_after == audit_count_before
    finally:
        await _cleanup(session, env, group_id, tag_id)


async def test_agent_create_commits_authoritative_facts_before_projection_failures(
    session,
    env,
    monkeypatch,
) -> None:
    group_id, tag_id = await _seed_group_and_tag(session, env)
    monkeypatch.setattr(
        ContentMembersOperations,
        "finish_member_add_after_commit",
        AsyncMock(side_effect=RuntimeError("member fanout unavailable")),
    )
    monkeypatch.setattr(
        TagOperations,
        "finish_manual_tags_after_commit",
        AsyncMock(side_effect=RuntimeError("tag projection unavailable")),
    )
    monkeypatch.setattr(
        AgentOperations,
        "_index_for_search",
        AsyncMock(side_effect=RuntimeError("search unavailable")),
    )
    monkeypatch.setattr(
        AgentOperations,
        "_broadcast_open_to_org_create",
        AsyncMock(side_effect=RuntimeError("realtime unavailable")),
    )
    monkeypatch.setattr(
        "uniffy.domains.agents.agents.operations.set_cached_agent",
        AsyncMock(side_effect=RuntimeError("cache unavailable")),
    )

    agent_id = None
    try:
        agent = await AgentOperations(session).create_agent(
            user_id=env.admin_id,
            organization_id=env.org_id,
            name=f"Durable agent {generate_id().hex[:10]}",
            access_mode=AccessMode.EXPLICIT_MEMBERS,
            group_ids=[group_id],
            tag_ids=[tag_id],
        )
        agent_id = agent.id

        async with open_session() as isolated:
            persisted_agent = await isolated.get(Agent, agent_id)
            member = (
                await isolated.execute(
                    select(ContentMember).where(
                        ContentMember.organization_id == env.org_id,
                        ContentMember.content_type == ContentType.AGENT,
                        ContentMember.content_id == agent_id,
                        ContentMember.subject_type == SubjectType.GROUP,
                        ContentMember.subject_id == group_id,
                    )
                )
            ).scalar_one()
            assignment = (
                await isolated.execute(
                    select(TagAssignment).where(
                        TagAssignment.content_urn == build_content_urn(ContentType.AGENT, agent_id),
                        TagAssignment.tag_id == tag_id,
                    )
                )
            ).scalar_one()
            audit_actions = set(
                (
                    await isolated.execute(
                        select(AuditEvent.action).where(AuditEvent.resource_id == agent_id)
                    )
                ).scalars()
            )

        assert persisted_agent is not None
        assert member.subject_id == group_id
        assert assignment.tag_id == tag_id
        assert Action.AGENT_CREATED in audit_actions
        assert Action.PERMISSIONS_MEMBER_ADDED in audit_actions
    finally:
        await _cleanup(session, env, group_id, tag_id, agent_id)
