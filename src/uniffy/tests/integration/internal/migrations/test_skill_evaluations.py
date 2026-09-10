import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import func, select

from uniffy.core.errors import (
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.rule import AgentRule, RuleSource
from uniffy.core.models.agents.skill import AgentSkill, AgentSkillSource
from uniffy.core.models.agents.skill_draft import (
    AgentSkillDraft,
    AgentSkillDraftKind,
    AgentSkillDraftStatus,
)
from uniffy.core.models.agents.skill_evaluation_case import AgentSkillEvaluationCase
from uniffy.core.models.agents.skill_evaluation_run import (
    AgentSkillEvaluationRun,
    SkillEvaluationError,
    SkillEvaluationStatus,
)
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.types import AccessMode, generate_id
from uniffy.domains.agents.providers.base import CompletionResult, ToolCall
from uniffy.domains.agents.rules.versions import stage_rule_version
from uniffy.domains.agents.runtime import capabilities
from uniffy.domains.agents.skills.evaluations import cases, lifecycle, operations, schemas
from uniffy.domains.agents.skills.evaluations.access import EvaluationScope, EvaluationTarget
from uniffy.domains.agents.skills.evaluations.cases import EvaluationCases
from uniffy.domains.agents.skills.evaluations.jobs import jobs
from uniffy.domains.agents.skills.evaluations.operations import EvaluationOperations
from uniffy.domains.agents.skills.operations import SkillOperations
from uniffy.domains.agents.tools.builtin.registration import register_all
from uniffy.domains.agents.tools.executor import ToolExecutor
from uniffy.domains.agents.tools.registry import ToolRegistry
from uniffy.tests.integration.internal.migrations.test_skill_generation import (
    generation_db as generation_db,
)

FIELDS = {
    "name": "Write report",
    "input": "Create a note with a short report.",
    "rubric": "The response explains what was created.",
    "expected_tools": ["notes.create_note"],
    "forbidden_tools": ["memory.forget"],
    "fixtures": [{"tool_name": "notes.create_note", "response": "Created sample note"}],
}


def completion(content="Done", **kwargs):
    return CompletionResult(
        content=content,
        model="gpt-4.1",
        input_tokens=100,
        output_tokens=20,
        provider_cost_usd=Decimal("0.001"),
        **kwargs,
    )


@pytest.fixture
async def evaluation_db(generation_db, monkeypatch):
    db = generation_db
    registry = ToolRegistry()
    register_all(registry)
    monkeypatch.setattr(capabilities, "get_tool_registry", lambda: registry)
    monkeypatch.setattr(schemas, "get_tool_registry", lambda: registry)
    monkeypatch.setattr(operations, "enqueue_evaluation", AsyncMock())
    monkeypatch.setattr(lifecycle, "open_session", db.sessions)
    monkeypatch.setattr(jobs, "open_session", db.sessions)
    monkeypatch.setattr(jobs, "get_ops_client", lambda: object())
    monkeypatch.setattr(jobs, "acquire_owned_job_lock", AsyncMock(return_value="owned"))
    monkeypatch.setattr(jobs, "release_owned_job_lock", AsyncMock())
    monkeypatch.setattr(
        ToolExecutor, "execute", AsyncMock(side_effect=AssertionError("Real tool executor reached"))
    )
    db.provider.chat_completion.side_effect = [
        completion(
            "", tool_calls=[ToolCall(id="call", name="notes-create_note", input={"title": "Report"})]
        ),
        completion(),
    ]
    monkeypatch.setattr(
        jobs, "resolve_provider_and_model", AsyncMock(return_value=(db.provider, None, "gpt-4.1"))
    )
    async with db.sessions() as session:
        skill = AgentSkill(
            organization_id=db.org.id,
            source=AgentSkillSource.ORGANIZATION,
            name="report",
            display_name="Report",
            content="Exact saved instructions",
            requires_tools=["notes.create_note"],
        )
        rule = AgentRule(
            organization_id=db.org.id,
            source=RuleSource.ORGANIZATION,
            name="sources",
            display_name="Sources",
            content="Always identify sources",
        )
        session.add_all([skill, rule])
        await session.flush()
        version = await SkillOperations(session).stage_skill_version(skill, author_id=db.builder.id)
        rule_version = await stage_rule_version(session, rule, author_id=db.builder.id)
        agent = await session.get(Agent, db.agent.id)
        agent.enabled_tools = ["notes.create_note", "memory.forget"]
        agent.enabled_rules = [str(rule.id)]
        agent.enabled_skills = [str(skill.id)]
        await session.commit()
        case = await EvaluationCases(session).create(
            user_id=db.builder.id,
            organization_id=db.org.id,
            scope=EvaluationScope(skill_id=skill.id),
            fields=FIELDS,
        )
    return NS(
        **vars(db), skill=skill, version=version, rule=rule, rule_version=rule_version, case=case
    )


async def request(db, **changes):
    fields = {
        "user_id": db.builder.id,
        "organization_id": db.org.id,
        "agent_id": db.agent.id,
        "request_id": generate_id(),
        "target": EvaluationTarget(skill_version_id=db.version.id),
        "case_ids": [db.case.id],
        **changes,
    }
    async with db.sessions() as session:
        return await EvaluationOperations(session).request(**fields)


async def read(db, identifier):
    async with db.sessions() as session:
        return await EvaluationOperations(session).get(
            user_id=db.builder.id, organization_id=db.org.id, run_id=identifier
        )


async def test_evaluation_requests_are_explicit_deduplicated_and_immutable(evaluation_db):
    db = evaluation_db
    request_id = generate_id()
    first, second = await asyncio.gather(
        request(db, request_id=request_id), request(db, request_id=request_id)
    )
    assert first[0].id == second[0].id
    operations.enqueue_evaluation.assert_awaited_once_with(first[0].id)
    db.provider.chat_completion.assert_not_awaited()
    with pytest.raises(ValidationError, match="already been used"):
        await request(db, request_id=request_id, judge=True)
    async with db.sessions() as session:
        await EvaluationCases(session).update(
            user_id=db.builder.id,
            organization_id=db.org.id,
            case_id=db.case.id,
            fields={**FIELDS, "input": "Different later input"},
        )
        skill = await session.get(AgentSkill, db.skill.id)
        skill.content = "Later active instructions"
        await SkillOperations(session).stage_skill_version(skill, author_id=db.builder.id)
        agent = await session.get(Agent, db.agent.id)
        agent.enabled_rules = []
        agent.enabled_tools = []
        await session.commit()
    run = await read(db, first[0].id)
    assert run.snapshot["case"]["input"] == FIELDS["input"]
    assert run.snapshot["skill"]["content"] == "Exact saved instructions"
    assert "Always identify sources" in run.snapshot["system_prompt"]
    assert run.snapshot["rule_version_ids"] == [str(db.rule_version.id)]
    assert {tool["name"] for tool in run.snapshot["schemas"]} == {
        "notes-create_note",
        "memory-forget",
    }
    await jobs.run_skill_evaluation({}, str(run.id))
    assert (await read(db, run.id)).status == SkillEvaluationStatus.PASSED


async def test_evaluation_access_checks_builder_agent_and_organization(evaluation_db):
    db = evaluation_db
    async with db.sessions() as session:
        private = Agent(
            organization_id=db.org.id,
            owner_id=db.user.id,
            name="Private",
            access_mode=AccessMode.OWNER_ONLY,
        )
        foreign = Agent(organization_id=db.foreign.id, owner_id=db.builder.id, name="Foreign")
        session.add_all([private, foreign])
        await session.commit()
        for actor, org in [(db.user.id, db.org.id), (db.builder.id, db.foreign.id)]:
            with pytest.raises(PermissionDeniedError):
                await EvaluationCases(session).list(
                    user_id=actor, organization_id=org, scope=EvaluationScope(skill_id=db.skill.id)
                )
    for overrides in [
        {"user_id": db.user.id},
        {"agent_id": private.id},
        {"agent_id": foreign.id},
        {"organization_id": db.foreign.id},
        {"case_ids": [generate_id()]},
    ]:
        with pytest.raises((PermissionDeniedError, NotFoundError, ValidationError)):
            await request(db, **overrides)
    operations.enqueue_evaluation.assert_not_awaited()
    [run] = await request(db)
    async with db.sessions() as session:
        agent = await session.get(Agent, db.agent.id)
        agent.is_deleted = True
        await session.commit()
        with pytest.raises((PermissionDeniedError, NotFoundError)):
            await EvaluationOperations(session).get(
                user_id=db.builder.id, organization_id=db.org.id, run_id=run.id
            )
    await jobs.run_skill_evaluation({}, str(run.id))
    async with db.sessions() as session:
        result = await session.get(AgentSkillEvaluationRun, run.id)
        assert result.error == SkillEvaluationError.ACCESS_REVOKED
    db.provider.chat_completion.assert_not_awaited()


async def test_evaluation_rechecks_access_before_publishing(evaluation_db):
    db = evaluation_db

    async def revoke(**kwargs):
        async with db.sessions() as session:
            membership = await session.scalar(
                select(OrganizationMember).where(
                    OrganizationMember.user_id == db.builder.id,
                    OrganizationMember.organization_id == db.org.id,
                )
            )
            membership.is_active = False
            await session.commit()
        return completion("Private result after removal")

    db.provider.chat_completion.side_effect = revoke
    [run] = await request(db)
    await jobs.run_skill_evaluation({}, str(run.id))
    async with db.sessions() as session:
        result = await session.get(AgentSkillEvaluationRun, run.id)
        assert result.error == SkillEvaluationError.ACCESS_REVOKED
        assert result.output == ""
        assert result.observations == {}
        assert result.input_tokens == 100


async def test_evaluation_expiry_and_late_queue_failure_do_not_repeat_work(evaluation_db):
    db = evaluation_db
    [run] = await request(db)
    assert await lifecycle.claim_evaluation(run.id)
    await lifecycle.finish_evaluation(
        run.id, error=SkillEvaluationError.QUEUE_UNAVAILABLE, only_queued=True
    )
    assert (await read(db, run.id)).status == SkillEvaluationStatus.RUNNING
    async with db.sessions() as session:
        row = await session.get(AgentSkillEvaluationRun, run.id)
        row.deadline_at = datetime.now(UTC) - timedelta(seconds=1)
        await session.commit()
    await jobs.expire_skill_evaluations({})
    await jobs.run_skill_evaluation({}, str(run.id))
    assert (await read(db, run.id)).error == SkillEvaluationError.INTERRUPTED
    db.provider.chat_completion.assert_not_awaited()


async def test_evaluation_case_and_run_audits_are_atomic(evaluation_db, monkeypatch):
    db = evaluation_db
    for module, operation in [(cases, "case"), (operations, "run")]:
        with monkeypatch.context() as patch:
            patch.setattr(
                module, "write_audit_event", AsyncMock(side_effect=RuntimeError("audit down"))
            )
            with pytest.raises(RuntimeError, match="audit down"):
                if operation == "run":
                    await request(db)
                else:
                    async with db.sessions() as session:
                        await EvaluationCases(session).create(
                            user_id=db.builder.id,
                            organization_id=db.org.id,
                            scope=EvaluationScope(skill_id=db.skill.id),
                            fields={**FIELDS, "name": "Not saved"},
                        )
    async with db.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(AgentSkillEvaluationCase)) == 1
        assert await session.scalar(select(func.count()).select_from(AgentSkillEvaluationRun)) == 0
    operations.enqueue_evaluation.assert_not_awaited()


async def test_evaluation_history_is_paginated_and_keeps_deleted_case_snapshot(evaluation_db):
    db = evaluation_db
    identifiers = [(await request(db))[0].id for _ in range(3)]
    async with db.sessions() as session:
        case_ops = EvaluationCases(session)
        await case_ops.delete(user_id=db.builder.id, organization_id=db.org.id, case_id=db.case.id)
        assert (
            await case_ops.list(
                user_id=db.builder.id,
                organization_id=db.org.id,
                scope=EvaluationScope(skill_id=db.skill.id),
            )
            == []
        )
        ops = EvaluationOperations(session)
        args = dict(
            user_id=db.builder.id,
            organization_id=db.org.id,
            agent_id=db.agent.id,
            scope=EvaluationScope(skill_id=db.skill.id),
            page_size=2,
        )
        first, cursor = await ops.list(**args)
        second, final_cursor = await ops.list(**args, cursor=cursor)
        assert {run.id for run in [*first, *second]} == set(identifiers)
        assert len(first) == 2 and len(second) == 1 and final_cursor == ""
        assert all(run.snapshot["case"]["name"] == FIELDS["name"] for run in first)
        with pytest.raises(ValidationError):
            await ops.list(**args, cursor="bad cursor")
        assert await session.scalar(select(func.count()).select_from(AuditEvent)) > 0


async def test_evaluation_draft_editor_snapshot_and_case_publication(evaluation_db):
    db = evaluation_db
    async with db.sessions() as session:
        draft = AgentSkillDraft(
            organization_id=db.org.id,
            owner_id=db.builder.id,
            kind=AgentSkillDraftKind.CREATE,
            status=AgentSkillDraftStatus.PENDING,
            name="draft-report",
            display_name="Draft report",
            content="Persisted draft body",
        )
        session.add(draft)
        await session.commit()
        case = await EvaluationCases(session).create(
            user_id=db.builder.id,
            organization_id=db.org.id,
            scope=EvaluationScope(draft_id=draft.id),
            fields=FIELDS,
        )
    [run] = await request(
        db,
        target=EvaluationTarget(draft_id=draft.id, draft_content="Current editor body"),
        case_ids=[case.id],
    )
    assert run.snapshot["skill"]["content"] == "Current editor body"
    async with db.sessions() as session:
        skill, version = await SkillOperations(session).save_skill_draft(
            user_id=db.builder.id,
            organization_id=db.org.id,
            draft_id=draft.id,
            name="draft-report",
            display_name="Draft report",
            content="Builder saved body",
        )
        published = await EvaluationCases(session).list(
            user_id=db.builder.id,
            organization_id=db.org.id,
            scope=EvaluationScope(skill_id=skill.id),
        )
        assert [item.id for item in published] == [case.id]
        assert published[0].draft_id is None
        history, _ = await EvaluationOperations(session).list(
            user_id=db.builder.id,
            organization_id=db.org.id,
            agent_id=db.agent.id,
            scope=EvaluationScope(skill_id=skill.id),
        )
        assert history[0].id == run.id and history[0].draft_id == draft.id
        assert history[0].skill_version_id is None
        assert history[0].snapshot["skill"]["content"] == "Current editor body"
        assert version.content == "Builder saved body"


async def test_evaluation_admission_caps_are_serialized(evaluation_db, monkeypatch):
    db = evaluation_db
    monkeypatch.setattr(operations, "MAX_OPEN_RUNS", 1)
    outcomes = await asyncio.gather(request(db), request(db), return_exceptions=True)
    assert sum(isinstance(value, list) for value in outcomes) == 1
    assert sum(isinstance(value, ValidationError) for value in outcomes) == 1
    operations.enqueue_evaluation.assert_awaited_once()
    monkeypatch.setattr(cases, "MAX_CASES", 1)
    async with db.sessions() as session:
        with pytest.raises(ValidationError, match="at most"):
            await EvaluationCases(session).create(
                user_id=db.builder.id,
                organization_id=db.org.id,
                scope=EvaluationScope(skill_id=db.skill.id),
                fields=FIELDS,
            )


async def test_evaluation_case_cap_prevents_partial_draft_replacement(evaluation_db, monkeypatch):
    db = evaluation_db
    async with db.sessions() as session:
        draft = AgentSkillDraft(
            organization_id=db.org.id,
            owner_id=db.builder.id,
            kind=AgentSkillDraftKind.CREATE,
            status=AgentSkillDraftStatus.PENDING,
            name="report",
            display_name="Replacement",
            content="Replacement body",
        )
        session.add(draft)
        await session.commit()
        await EvaluationCases(session).create(
            user_id=db.builder.id,
            organization_id=db.org.id,
            scope=EvaluationScope(draft_id=draft.id),
            fields=FIELDS,
        )
    monkeypatch.setattr(cases, "MAX_CASES", 1)
    with pytest.raises(ValidationError, match="combining"):
        async with db.sessions() as session:
            await SkillOperations(session).save_skill_draft(
                user_id=db.builder.id,
                organization_id=db.org.id,
                draft_id=draft.id,
                name="report",
                display_name="Replacement",
                content="Replacement body",
                allow_replace=True,
            )
    async with db.sessions() as session:
        skill = await session.get(AgentSkill, db.skill.id)
        assert skill.content == "Exact saved instructions"
        assert skill.active_version_id == db.version.id
        assert (await session.get(AgentSkillDraft, draft.id)).status == AgentSkillDraftStatus.PENDING
