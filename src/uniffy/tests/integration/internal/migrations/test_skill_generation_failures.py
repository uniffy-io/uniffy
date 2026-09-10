import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import func, select

from uniffy.core.errors import BudgetExceededError, PermissionDeniedError, ValidationError
from uniffy.core.models.agents.message import AgentMessage
from uniffy.core.models.agents.run_log import AgentRunLog
from uniffy.core.models.agents.skill import AgentSkill
from uniffy.core.models.agents.skill_draft import (
    AgentSkillDraft,
    AgentSkillDraftStatus,
    SkillGenerationError,
)
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.domains.agents.skills import generation, operations
from uniffy.domains.agents.skills.generation import SkillDraftGeneration
from uniffy.domains.agents.skills.jobs import jobs
from uniffy.domains.agents.skills.operations import SkillOperations
from uniffy.domains.agents.skills.proposal import parse_proposal
from uniffy.tests.integration.internal.migrations.test_skill_generation import (
    PROPOSAL,
    request_draft,
)
from uniffy.tests.integration.internal.migrations.test_skill_generation import (
    generation_db as generation_db,
)


@pytest.mark.parametrize(
    "code",
    [
        SkillGenerationError.PROVIDER_REQUIRED,
        SkillGenerationError.BUDGET_EXCEEDED,
        SkillGenerationError.INVALID_PROPOSAL,
        SkillGenerationError.INTERRUPTED,
        SkillGenerationError.QUEUE_UNAVAILABLE,
        SkillGenerationError.ACCESS_REVOKED,
    ],
)
async def test_failures_settle_without_automatic_retry(generation_db, monkeypatch, code):
    db = generation_db
    draft = await request_draft(db)
    if code == SkillGenerationError.PROVIDER_REQUIRED:
        monkeypatch.setattr(
            jobs,
            "resolve_provider_and_model",
            AsyncMock(side_effect=ValidationError("model", "Configure a provider")),
        )
    elif code == SkillGenerationError.BUDGET_EXCEEDED:
        monkeypatch.setattr(
            jobs.BudgetsOperations,
            "check_preflight",
            AsyncMock(side_effect=BudgetExceededError("org", "month", "10", "10")),
        )
    elif code == SkillGenerationError.INVALID_PROPOSAL:
        db.provider.chat_completion.return_value.content = "Invalid response"
    elif code == SkillGenerationError.INTERRUPTED:
        db.provider.chat_completion.side_effect = TimeoutError
    elif code == SkillGenerationError.ACCESS_REVOKED:
        async with db.sessions() as session:
            message = await session.get(AgentMessage, db.reply.id)
            message.is_invalidated = True
            await session.commit()
    else:
        monkeypatch.setattr(jobs, "get_ops_client", lambda: None)
    await jobs.generate_skill_draft({}, str(draft.id), 1)
    await jobs.generate_skill_draft({}, str(draft.id), 1)
    async with db.sessions() as session:
        persisted = await session.get(AgentSkillDraft, draft.id)
        assert persisted.status == AgentSkillDraftStatus.GENERATION_FAILED
        assert persisted.generation_error == code
        assert persisted.content == ""
        assert await session.scalar(select(func.count()).select_from(AgentSkill)) == 0
    assert db.provider.chat_completion.await_count == (
        code in (SkillGenerationError.INVALID_PROPOSAL, SkillGenerationError.INTERRUPTED)
    )
    db.enqueue.assert_awaited_once()


async def test_permission_is_rechecked_after_the_provider_returns(generation_db):
    db = generation_db
    draft = await request_draft(db)
    response = db.provider.chat_completion.return_value

    async def revoke_during_generation(**kwargs):
        async with db.sessions() as session:
            membership = await session.get(OrganizationMember, db.membership.id)
            membership.is_active = False
            await session.commit()
        return response

    db.provider.chat_completion.side_effect = revoke_during_generation
    await jobs.generate_skill_draft({}, str(draft.id), 1)
    async with db.sessions() as session:
        persisted = await session.get(AgentSkillDraft, draft.id)
        assert persisted.generation_error == SkillGenerationError.ACCESS_REVOKED
        assert persisted.content == ""
        assert await session.scalar(select(func.count()).select_from(AgentRunLog)) == 1


async def test_claim_gives_queued_work_a_full_execution_deadline(generation_db):
    db = generation_db
    draft = await request_draft(db)
    original_deadline = datetime.now(UTC) + timedelta(seconds=30)
    async with db.sessions() as session:
        pending = await session.get(AgentSkillDraft, draft.id)
        pending.generation_deadline_at = original_deadline
        await session.commit()
    response = db.provider.chat_completion.return_value

    async def inspect_claim(**kwargs):
        async with db.sessions() as session:
            running = await session.get(AgentSkillDraft, draft.id)
            assert running.generation_deadline_at > original_deadline + timedelta(seconds=200)
        return response

    db.provider.chat_completion.side_effect = inspect_claim
    await jobs.generate_skill_draft({}, str(draft.id), 1)
    async with db.sessions() as session:
        assert (await session.get(AgentSkillDraft, draft.id)).status == AgentSkillDraftStatus.PENDING


async def test_uncertain_enqueue_does_not_overwrite_completed_generation(generation_db, monkeypatch):
    db = generation_db

    async def delivered_then_disconnected(ref, draft_id, attempt, **kwargs):
        await jobs.generate_skill_draft({}, draft_id, attempt)
        raise TimeoutError

    monkeypatch.setattr(generation, "enqueue_job_reconnecting", delivered_then_disconnected)
    draft = await request_draft(db)
    assert draft.status == AgentSkillDraftStatus.PENDING
    assert draft.generation_error is None
    db.provider.chat_completion.assert_awaited_once()


async def test_expiry_rechecks_deadline_after_an_in_progress_claim(generation_db, monkeypatch):
    db = generation_db
    draft = await request_draft(db)
    async with db.sessions() as session:
        pending = await session.get(AgentSkillDraft, draft.id)
        pending.generation_deadline_at = datetime.now(UTC) - timedelta(seconds=1)
        await session.commit()

    expiry_ready = asyncio.Event()
    finish = jobs._finish

    async def signal_expiry(*args, **kwargs):
        expiry_ready.set()
        await finish(*args, **kwargs)

    monkeypatch.setattr(jobs, "_finish", signal_expiry)
    async with db.sessions() as session:
        claimed = await session.get(AgentSkillDraft, draft.id)
        claimed.generation_started_at = datetime.now(UTC)
        claimed.generation_deadline_at = datetime.now(UTC) + timedelta(minutes=6)
        await session.flush()
        async with asyncio.timeout(5), asyncio.TaskGroup() as tasks:
            tasks.create_task(jobs.expire_skill_draft_generations({}))
            await expiry_ready.wait()
            await session.commit()

    async with db.sessions() as session:
        persisted = await session.get(AgentSkillDraft, draft.id)
        assert persisted.status == AgentSkillDraftStatus.GENERATING
        assert persisted.generation_error is None
    db.provider.chat_completion.assert_not_awaited()


async def test_builder_publication_and_audit_rollback(generation_db, monkeypatch):
    db = generation_db
    draft = await request_draft(db)
    await jobs._finish(draft.id, 1, proposal=parse_proposal(PROPOSAL))
    fields = dict(
        organization_id=db.org.id,
        draft_id=draft.id,
        name="report",
        display_name="Report",
        content="Reviewed instructions",
    )
    async with db.sessions() as session:
        service = SkillDraftGeneration(session)
        own = await service.get(
            user_id=db.user.id,
            organization_id=db.org.id,
            draft_id=draft.id,
        )
        assert own.content == parse_proposal(PROPOSAL).content
        ops = SkillOperations(session)
        with pytest.raises(PermissionDeniedError):
            await ops.list_skill_drafts(user_id=db.user.id, organization_id=db.org.id)
        with pytest.raises(PermissionDeniedError):
            await ops.save_skill_draft(user_id=db.user.id, **fields)
    with monkeypatch.context() as context:
        context.setattr(
            operations,
            "write_audit_event",
            AsyncMock(side_effect=RuntimeError("audit failed")),
        )
        with pytest.raises(RuntimeError, match="audit failed"):
            async with db.sessions() as session:
                await SkillOperations(session).save_skill_draft(user_id=db.builder.id, **fields)
    async with db.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(AgentSkill)) == 0
        assert (await session.get(AgentSkillDraft, draft.id)).status == AgentSkillDraftStatus.PENDING
        skill, version = await SkillOperations(session).save_skill_draft(
            user_id=db.builder.id,
            **fields,
        )
        assert skill.content == fields["content"]
        assert skill.active_version_id == version.id
        assert (await session.get(AgentSkillDraft, draft.id)).status == AgentSkillDraftStatus.SAVED
        assert await session.scalar(select(func.count()).select_from(AuditEvent)) == 1
