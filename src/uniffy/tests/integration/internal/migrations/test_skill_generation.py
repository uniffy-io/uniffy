import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.jobs import JobEnqueueOutcome, JobEnqueueResult
from uniffy.core.json_codec import dumps_str, loads
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.message import AgentMessage, AgentMessageRole
from uniffy.core.models.agents.run_log import AgentRunLog
from uniffy.core.models.agents.session import AgentSession, AgentSessionKind
from uniffy.core.models.agents.skill import AgentSkill, AgentSkillSource, SkillSurface
from uniffy.core.models.agents.skill_draft import (
    AgentSkillDraft,
    AgentSkillDraftKind,
    AgentSkillDraftStatus,
    SkillGenerationError,
)
from uniffy.core.models.agents.skill_invocation import AgentSkillInvocation, SkillInvocationStatus
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.chat.message import ChatMessage, ChatMessageMetadataKind, SenderType
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember, OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.core.types import AccessMode, ContentRole, SubjectType, generate_id
from uniffy.domains.agents.invocation import read_response_skill_attributions
from uniffy.domains.agents.providers.base import CompletionResult
from uniffy.domains.agents.skills import generation, operations
from uniffy.domains.agents.skills.evidence import MAX_EVIDENCE_CHARACTERS, load_draft_evidence
from uniffy.domains.agents.skills.generation import SkillDraftGeneration
from uniffy.domains.agents.skills.jobs import jobs
from uniffy.domains.agents.skills.jobs.contracts import GENERATE_SKILL_DRAFT
from uniffy.domains.agents.skills.operations import SkillOperations
from uniffy.domains.agents.skills.proposal import parse_proposal
from uniffy.domains.agents.skills.quotas import MAX_PENDING_DRAFTS_PER_USER
from uniffy.infrastructure.database.session import get_database_url
from uniffy.tests.integration.internal.migrations.test_migration_run import _provision_to

PROPOSAL = dumps_str({
    "name": "report",
    "display_name": "Report",
    "description": "Summarize the selected material",
    "content": "Write a concise report with sources.",
})


@pytest.fixture
async def generation_db(scratch_database, monkeypatch):
    await _provision_to(scratch_database, "head")
    engine = create_async_engine(get_database_url())
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    enqueue = AsyncMock(return_value=JobEnqueueResult(None, JobEnqueueOutcome.ENQUEUED))
    monkeypatch.setattr(generation, "enqueue_job_reconnecting", enqueue)
    monkeypatch.setattr(generation, "publish_draft_card", AsyncMock())
    monkeypatch.setattr(operations, "publish_draft_card", AsyncMock())
    monkeypatch.setattr(operations, "invalidate_agents_using_skill", AsyncMock())
    monkeypatch.setattr(jobs, "publish_draft_card", AsyncMock())
    monkeypatch.setattr(jobs, "open_session", sessions)
    monkeypatch.setattr(jobs, "get_ops_client", lambda: object())
    monkeypatch.setattr(jobs, "acquire_owned_job_lock", AsyncMock(return_value="owned"))
    monkeypatch.setattr(jobs, "release_owned_job_lock", AsyncMock())
    provider = NS(
        name="openai",
        chat_completion=AsyncMock(
            return_value=CompletionResult(
                content=PROPOSAL,
                model="gpt-4.1",
                input_tokens=100,
                output_tokens=20,
                provider_cost_usd=Decimal("0.001"),
            )
        ),
    )
    monkeypatch.setattr(
        jobs,
        "resolve_provider_and_model",
        AsyncMock(return_value=(provider, None, "gpt-4.1")),
    )
    async with sessions() as session:
        org = Organization(name="Drafts", slug="drafts")
        foreign = Organization(name="Foreign", slug="foreign")
        user = User(username="requester", email="requester@example.test")
        builder = User(username="builder", email="builder@example.test")
        session.add_all([org, foreign, user, builder])
        await session.flush()
        membership = OrganizationMember(organization_id=org.id, user_id=user.id)
        session.add_all([
            membership,
            OrganizationMember(
                organization_id=org.id,
                user_id=builder.id,
                role=OrganizationRole.OWNER,
            ),
        ])
        agent = Agent(
            organization_id=org.id,
            owner_id=builder.id,
            name="Reporter",
            access_mode=AccessMode.OPEN_TO_ORG,
            baseline_role=ContentRole.VIEWER,
        )
        session.add(agent)
        await session.flush()
        conversation = AgentSession(
            organization_id=org.id,
            agent_id=agent.id,
            user_id=user.id,
            kind=AgentSessionKind.DIRECT,
        )
        other = AgentSession(
            organization_id=org.id,
            agent_id=agent.id,
            user_id=builder.id,
            kind=AgentSessionKind.DIRECT,
        )
        session.add_all([conversation, other])
        await session.flush()
        trigger = AgentMessage(
            session_id=conversation.id,
            role=AgentMessageRole.USER,
            content="Write a report",
        )
        reply = AgentMessage(
            session_id=conversation.id,
            role=AgentMessageRole.ASSISTANT,
            content="Report result",
        )
        other_reply = AgentMessage(
            session_id=other.id,
            role=AgentMessageRole.ASSISTANT,
            content="Private result",
        )
        session.add_all([trigger, reply, other_reply])
        await session.commit()
    db = NS(
        sessions=sessions,
        org=org,
        foreign=foreign,
        user=user,
        builder=builder,
        membership=membership,
        agent=agent,
        conversation=conversation,
        other=other,
        trigger=trigger,
        reply=reply,
        other_reply=other_reply,
        enqueue=enqueue,
        provider=provider,
    )
    try:
        yield db
    finally:
        await engine.dispose()


def request_args(db, **overrides):
    return {
        "user_id": db.user.id,
        "organization_id": db.org.id,
        "request_id": generate_id(),
        "agent_id": db.agent.id,
        "session_id": db.conversation.id,
        "evidence_message_ids": [db.trigger.id, db.reply.id],
        "rationale": "Make this report reusable",
        **overrides,
    }


async def request_draft(db, **overrides):
    async with db.sessions() as session:
        return await SkillDraftGeneration(session).request(**request_args(db, **overrides))


async def test_concurrent_duplicate_requests_enqueue_once_and_remain_inert(generation_db):
    db = generation_db
    identifier = generate_id()
    first, second = await asyncio.gather(
        request_draft(db, request_id=identifier),
        request_draft(db, request_id=identifier),
    )
    assert first.id == second.id == identifier
    assert first.status == AgentSkillDraftStatus.GENERATING
    db.enqueue.assert_awaited_once_with(
        GENERATE_SKILL_DRAFT,
        str(identifier),
        1,
        _job_id=f"skill-draft:{identifier}:1",
    )
    async with db.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(AgentSkill)) == 0
        assert await session.scalar(select(func.count()).select_from(AgentRunLog)) == 0
    db.provider.chat_completion.assert_not_awaited()
    with pytest.raises(ValidationError, match="already been used"):
        await request_draft(db, request_id=identifier, rationale="Different request")


async def test_evidence_scope_and_removed_membership_fail_before_enqueue(generation_db):
    db = generation_db
    for overrides in (
        {"session_id": db.other.id, "evidence_message_ids": [db.other_reply.id]},
        {"evidence_message_ids": [db.other_reply.id]},
        {"organization_id": db.foreign.id},
        {"evidence_message_ids": [db.reply.id, db.reply.id]},
        {"evidence_message_ids": [generate_id()]},
    ):
        with pytest.raises((PermissionDeniedError, ValidationError, NotFoundError)):
            await request_draft(db, **overrides)
    async with db.sessions() as session:
        reply = await session.get(AgentMessage, db.reply.id)
        reply.content = "x" * (MAX_EVIDENCE_CHARACTERS + 1)
        await session.commit()
    with pytest.raises(ValidationError, match="fewer"):
        await request_draft(db, evidence_message_ids=[db.reply.id])
    async with db.sessions() as session:
        membership = await session.get(OrganizationMember, db.membership.id)
        membership.is_active = False
        await session.commit()
    with pytest.raises(PermissionDeniedError):
        await request_draft(db)
    db.enqueue.assert_not_awaited()


async def test_improvement_uses_recorded_version_and_requires_its_response(generation_db):
    db = generation_db
    async with db.sessions() as session:
        skill = AgentSkill(
            organization_id=db.org.id,
            name="report",
            display_name="Report",
            source=AgentSkillSource.ORGANIZATION,
            content="Invoked body",
            requires_tools=["search.query"],
            supported_surfaces=["session"],
        )
        session.add(skill)
        await session.flush()
        ops = SkillOperations(session)
        invoked = await ops.stage_skill_version(skill, author_id=db.builder.id)
        skill.content = "Latest body"
        await ops.stage_skill_version(skill, author_id=db.builder.id)
        invocation = AgentSkillInvocation(
            organization_id=db.org.id,
            user_id=db.user.id,
            agent_id=db.agent.id,
            skill_id=skill.id,
            skill_version_id=invoked.id,
            skill_version_number=1,
            surface=SkillSurface.SESSION,
            session_id=db.conversation.id,
            trigger_message_id=db.trigger.id,
            response_message_id=db.reply.id,
            status=SkillInvocationStatus.COMPLETED,
            completed_at=datetime.now(UTC),
        )
        session.add(invocation)
        await session.commit()
    draft = await request_draft(db, invocation_id=invocation.id)
    assert draft.target_skill_id == skill.id
    assert draft.target_version_id == invoked.id
    assert draft.target_version_number == 1
    assert draft.requires_tools == ["search.query"]
    async with db.sessions() as session:
        evidence = await load_draft_evidence(session, draft)
        assert evidence.version.content == "Invoked body"
        facts = await read_response_skill_attributions(
            session,
            organization_id=db.org.id,
            session_id=db.conversation.id,
            response_ids=[db.reply.id, db.other_reply.id],
        )
        assert facts[db.reply.id]["skill_version_number"] == "1"
        assert db.other_reply.id not in facts
    with pytest.raises(ValidationError):
        await request_draft(db, invocation_id=invocation.id, evidence_message_ids=[db.trigger.id])
    with pytest.raises(ValidationError):
        await request_draft(db, invocation_id=invocation.id, evidence_message_ids=[db.reply.id])
    await jobs.generate_skill_draft({}, str(draft.id), 1)
    sent = loads(db.provider.chat_completion.await_args.kwargs["messages"][0]["content"])
    assert sent["skill"]["content"] == "Invoked body"


async def test_generation_records_spend_and_repeated_jobs_do_not_repeat_provider(generation_db):
    db = generation_db
    draft = await request_draft(db)
    await asyncio.gather(
        jobs.generate_skill_draft({}, str(draft.id), 1),
        jobs.generate_skill_draft({}, str(draft.id), 1),
    )
    db.provider.chat_completion.assert_awaited_once()
    assert db.provider.chat_completion.await_args.kwargs["tools"] is None
    async with db.sessions() as session:
        persisted = await session.get(AgentSkillDraft, draft.id)
        assert persisted.status == AgentSkillDraftStatus.PENDING
        assert persisted.content == parse_proposal(PROPOSAL).content
        assert await session.scalar(select(func.count()).select_from(AgentSkill)) == 0
        log = (await session.execute(select(AgentRunLog))).scalar_one()
        assert log.input_tokens == 100
        assert log.user_id == db.user.id
        assert log.organization_id == db.org.id
        assert log.cost == Decimal("0.001")


async def test_queue_failure_requires_owned_explicit_retry_and_expiry_never_calls_provider(
    generation_db,
):
    db = generation_db
    db.enqueue.return_value = JobEnqueueResult(None, JobEnqueueOutcome.UNAVAILABLE)
    draft = await request_draft(db)
    assert draft.status == AgentSkillDraftStatus.GENERATION_FAILED
    assert draft.generation_error == SkillGenerationError.QUEUE_UNAVAILABLE
    async with db.sessions() as session:
        service = SkillDraftGeneration(session)
        with pytest.raises(PermissionDeniedError):
            await service.retry(
                user_id=db.builder.id,
                organization_id=db.org.id,
                draft_id=draft.id,
                expected_attempt=1,
            )
    db.enqueue.return_value = JobEnqueueResult(None, JobEnqueueOutcome.ENQUEUED)
    async with db.sessions() as session:
        service = SkillDraftGeneration(session)
        retried = await service.retry(
            user_id=db.user.id,
            organization_id=db.org.id,
            draft_id=draft.id,
            expected_attempt=1,
        )
        assert retried.generation_attempt == 2
        await service.retry(
            user_id=db.user.id,
            organization_id=db.org.id,
            draft_id=draft.id,
            expected_attempt=1,
        )
        retried.generation_deadline_at = datetime.now(UTC) - timedelta(seconds=1)
        await session.commit()
    assert db.enqueue.await_count == 2
    await jobs.expire_skill_draft_generations({})
    await jobs.generate_skill_draft({}, str(draft.id), 1)
    db.provider.chat_completion.assert_not_awaited()
    async with db.sessions() as session:
        persisted = await session.get(AgentSkillDraft, draft.id)
        assert persisted.status == AgentSkillDraftStatus.GENERATION_FAILED
        assert persisted.generation_error == SkillGenerationError.INTERRUPTED


async def test_revocation_and_discard_prevent_publication(generation_db):
    db = generation_db
    revoked = await request_draft(db)
    discarded = await request_draft(db)
    async with db.sessions() as session:
        await SkillOperations(session).discard_skill_draft(
            user_id=db.builder.id,
            organization_id=db.org.id,
            draft_id=discarded.id,
        )
        membership = await session.get(OrganizationMember, db.membership.id)
        membership.is_active = False
        await session.commit()
    await jobs.generate_skill_draft({}, str(revoked.id), 1)
    await jobs._finish(discarded.id, 1, proposal=parse_proposal(PROPOSAL))
    db.provider.chat_completion.assert_not_awaited()
    async with db.sessions() as session:
        assert (
            await session.get(AgentSkillDraft, revoked.id)
        ).generation_error == SkillGenerationError.ACCESS_REVOKED
        assert (
            await session.get(AgentSkillDraft, discarded.id)
        ).status == AgentSkillDraftStatus.DISCARDED


async def test_quota_is_serialized_and_counts_all_open_states(generation_db):
    db = generation_db
    async with db.sessions() as session:
        for number in range(MAX_PENDING_DRAFTS_PER_USER - 1):
            session.add(
                AgentSkillDraft(
                    organization_id=db.org.id,
                    owner_id=db.user.id,
                    kind=AgentSkillDraftKind.CREATE,
                    status=AgentSkillDraftStatus.GENERATION_FAILED
                    if number % 2
                    else AgentSkillDraftStatus.PENDING,
                )
            )
        await session.commit()
    results = await asyncio.gather(request_draft(db), request_draft(db), return_exceptions=True)
    assert sum(isinstance(result, AgentSkillDraft) for result in results) == 1
    assert sum(isinstance(result, ValidationError) for result in results) == 1
    db.enqueue.assert_awaited_once()


async def test_chat_evidence_stays_on_one_branch_and_card_is_atomic(generation_db):
    db = generation_db
    async with db.sessions() as session:
        channel = ChatChannel(
            organization_id=db.org.id,
            owner_id=db.user.id,
            name="Private",
            slug="private",
            channel_type=ChannelType.PRIVATE,
        )
        session.add(channel)
        await session.flush()
        session.add(
            ChatChannelMember(
                channel_id=channel.id,
                subject_type=SubjectType.USER,
                subject_id=db.user.id,
                user_id=db.user.id,
            )
        )
        root = ChatMessage(channel_id=channel.id, sender_id=db.user.id, content="Root")
        sibling = ChatMessage(channel_id=channel.id, sender_id=db.user.id, content="Sibling")
        session.add_all([root, sibling])
        await session.flush()
        reply = ChatMessage(
            channel_id=channel.id,
            sender_id=db.agent.id,
            sender_type=SenderType.AGENT,
            root_id=root.id,
            reply_to_id=root.id,
            content="Thread reply",
            message_metadata={"kind": ChatMessageMetadataKind.FINAL},
        )
        session.add(reply)
        await session.commit()
    kwargs = {
        "session_id": None,
        "channel_id": channel.id,
        "thread_root_id": root.id,
        "evidence_message_ids": [root.id, reply.id],
    }
    draft = await request_draft(db, **kwargs)
    async with db.sessions() as session:
        card = await session.get(ChatMessage, draft.origin_chat_message_id)
        assert card.root_id == root.id
        assert card.message_metadata["draft_status"] == AgentSkillDraftStatus.GENERATING
        await SkillOperations(session).discard_skill_draft(
            user_id=db.builder.id,
            organization_id=db.org.id,
            draft_id=draft.id,
        )
    async with db.sessions() as session:
        card = await session.get(ChatMessage, draft.origin_chat_message_id)
        assert card.message_metadata["draft_status"] == AgentSkillDraftStatus.DISCARDED
    with pytest.raises(ValidationError):
        await request_draft(db, **{**kwargs, "evidence_message_ids": [sibling.id, reply.id]})
    with pytest.raises(ValidationError):
        await request_draft(db, **{**kwargs, "thread_root_id": None})
    async with db.sessions() as session:
        row = await session.get(ChatChannel, channel.id)
        row.is_archived = True
        await session.commit()
    with pytest.raises(ValidationError, match="archived"):
        await request_draft(db, **kwargs)
