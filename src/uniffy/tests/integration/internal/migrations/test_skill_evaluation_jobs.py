import asyncio
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from uniffy.core.errors import BudgetExceededError, ValidationError
from uniffy.core.json_codec import dumps_str
from uniffy.core.models.agents.run_log import AgentRunKind, AgentRunLog
from uniffy.core.models.agents.skill import AgentSkill
from uniffy.core.models.agents.skill_evaluation_run import (
    SkillEvaluationError,
    SkillEvaluationStatus,
)
from uniffy.domains.agents.providers.base import ToolCall
from uniffy.domains.agents.skills.evaluations import lifecycle, operations
from uniffy.domains.agents.skills.evaluations.jobs import jobs
from uniffy.domains.agents.tools.executor import ToolExecutor
from uniffy.tests.integration.internal.migrations.test_skill_evaluations import (
    completion,
    read,
    request,
)
from uniffy.tests.integration.internal.migrations.test_skill_evaluations import (
    evaluation_db as evaluation_db,
)
from uniffy.tests.integration.internal.migrations.test_skill_evaluations import (
    generation_db as generation_db,
)


async def test_evaluation_execution_uses_fixtures_and_accounts_for_judging_once(evaluation_db):
    db = evaluation_db
    db.provider.chat_completion.side_effect = [
        completion(
            "",
            tool_calls=[ToolCall(id="write", name="notes-create_note", input={"title": "Report"})],
        ),
        completion("Report created"),
        completion(dumps_str({"score": 0.8, "rationale": "Clear response"})),
    ]
    [run] = await request(db, judge=True)
    await asyncio.gather(
        jobs.run_skill_evaluation({}, str(run.id)), jobs.run_skill_evaluation({}, str(run.id))
    )
    result = await read(db, run.id)
    assert result.status == SkillEvaluationStatus.PASSED
    assert result.judge_result == {
        "status": "completed",
        "score": 0.8,
        "rationale": "Clear response",
    }
    assert result.input_tokens == 300
    assert result.output_tokens == 60
    assert result.cost is not None and result.cost > 0
    assert result.observations["tool_attempts"][0]["fixture_response"] == "Created sample note"
    ToolExecutor.execute.assert_not_awaited()
    assert db.provider.chat_completion.await_count == 3
    async with db.sessions() as session:
        logs = list((await session.scalars(select(AgentRunLog))).all())
        assert len(logs) == 1
        assert logs[0].kind == AgentRunKind.EVALUATION
        assert len(logs[0].model_calls) == 3
        assert (await session.get(AgentSkill, db.skill.id)).active_version_id == db.version.id


@pytest.mark.parametrize("judge_failure", ["invalid JSON", "budget", "provider"])
async def test_evaluation_judge_failure_keeps_tool_assertions(
    evaluation_db, monkeypatch, judge_failure
):
    db = evaluation_db
    response = (
        RuntimeError("private provider diagnostic")
        if judge_failure == "provider"
        else completion("invalid JSON")
    )
    db.provider.chat_completion.side_effect = [
        completion("", tool_calls=[ToolCall(id="call", name="notes-create_note", input={})]),
        completion(),
        response,
    ]
    if judge_failure == "budget":
        monkeypatch.setattr(
            jobs.BudgetsOperations,
            "check_preflight",
            AsyncMock(
                side_effect=[None, None, BudgetExceededError("organization", "cost", "10", "10")]
            ),
        )
    [run] = await request(db, judge=True)
    await jobs.run_skill_evaluation({}, str(run.id))
    result = await read(db, run.id)
    assert result.status == SkillEvaluationStatus.PASSED
    assert result.judge_result["status"] == "error"
    assert "private provider diagnostic" not in str(result.judge_result)
    assert result.input_tokens >= 200


@pytest.mark.parametrize("failure", ["queue", "valkey", "provider", "budget", "lease"])
async def test_evaluation_unavailable_dependencies_fail_without_paid_work(
    evaluation_db, monkeypatch, failure
):
    db = evaluation_db
    if failure == "queue":
        monkeypatch.setattr(operations, "enqueue_evaluation", lifecycle.enqueue_evaluation)
        monkeypatch.setattr(
            lifecycle,
            "enqueue_job_reconnecting",
            AsyncMock(side_effect=ConnectionError("private queue detail")),
        )
    elif failure == "valkey":
        monkeypatch.setattr(jobs, "get_ops_client", lambda: None)
    elif failure == "provider":
        monkeypatch.setattr(
            jobs,
            "resolve_provider_and_model",
            AsyncMock(side_effect=ValidationError("model", "Not configured")),
        )
    elif failure == "budget":
        monkeypatch.setattr(
            jobs.BudgetsOperations,
            "check_preflight",
            AsyncMock(side_effect=BudgetExceededError("organization", "cost", "10", "10")),
        )
    else:
        monkeypatch.setattr(
            jobs,
            "acquire_owned_job_lock",
            AsyncMock(side_effect=ConnectionError("private lease detail")),
        )
    [run] = await request(db)
    await jobs.run_skill_evaluation({}, str(run.id))
    result = await read(db, run.id)
    assert result.status == SkillEvaluationStatus.ERROR
    assert (
        result.error
        == {
            "queue": SkillEvaluationError.QUEUE_UNAVAILABLE,
            "valkey": SkillEvaluationError.QUEUE_UNAVAILABLE,
            "provider": SkillEvaluationError.PROVIDER_REQUIRED,
            "budget": SkillEvaluationError.BUDGET_EXCEEDED,
            "lease": SkillEvaluationError.INTERRUPTED,
        }[failure]
    )
    assert result.output == ""
    db.provider.chat_completion.assert_not_awaited()
