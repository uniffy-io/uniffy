from protobuf import Oneof
from uniffy_proto.agents.v1 import skill_evaluations_pb as proto

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.models.agents.skill_evaluation_case import AgentSkillEvaluationCase
from uniffy.core.models.agents.skill_evaluation_run import (
    AgentSkillEvaluationRun,
    SkillEvaluationStatus,
)

STATUS_TO_PROTO = {
    SkillEvaluationStatus.QUEUED: proto.EvaluationStatus.QUEUED,
    SkillEvaluationStatus.RUNNING: proto.EvaluationStatus.RUNNING,
    SkillEvaluationStatus.PASSED: proto.EvaluationStatus.PASSED,
    SkillEvaluationStatus.FAILED: proto.EvaluationStatus.FAILED,
    SkillEvaluationStatus.INCONCLUSIVE: proto.EvaluationStatus.INCONCLUSIVE,
    SkillEvaluationStatus.ERROR: proto.EvaluationStatus.ERROR,
}


def fields_to_proto(fields: dict) -> proto.EvaluationCaseFields:
    return proto.EvaluationCaseFields(
        name=fields["name"],
        input=fields["input"],
        rubric=fields.get("rubric", ""),
        expected_tools=fields.get("expected_tools", []),
        forbidden_tools=fields.get("forbidden_tools", []),
        fixtures=[proto.ToolFixture(**fixture) for fixture in fields.get("fixtures", [])],
    )


def case_to_proto(case: AgentSkillEvaluationCase) -> proto.EvaluationCase:
    scope = (
        proto.EvaluationScope(scope=Oneof(field="skill_id", value=str(case.skill_id)))
        if case.skill_id
        else proto.EvaluationScope(scope=Oneof(field="draft_id", value=str(case.draft_id)))
    )
    return proto.EvaluationCase(
        id=str(case.id),
        scope=scope,
        fields=fields_to_proto(case.fields),
        created_at=datetime_to_timestamp(case.created_at),
        updated_at=datetime_to_timestamp(case.updated_at),
    )


def run_to_proto(run: AgentSkillEvaluationRun) -> proto.EvaluationRun:
    result = proto.EvaluationRun(
        id=str(run.id),
        request_id=str(run.request_id),
        case_id=str(run.case_id),
        agent_id=str(run.agent_id),
        version_number=run.version_number,
        target_digest=run.target_digest,
        status=STATUS_TO_PROTO[run.status],
        error=run.error or "",
        case_snapshot=fields_to_proto(run.snapshot["case"]),
        target_content=run.snapshot["skill"]["content"],
        output=run.output,
        tool_attempts=[
            proto.EvaluationToolAttempt(
                tool_name=attempt["tool_name"],
                input_json=attempt["input_json"],
                fixture_response=attempt["fixture_response"],
                fixture_used=attempt["fixture_used"],
                issue=attempt.get("issue") or "",
            )
            for attempt in run.observations.get("tool_attempts", [])
        ],
        assertions=[
            proto.EvaluationAssertion(**assertion)
            for assertion in run.observations.get("assertions", [])
        ],
        judge=proto.EvaluationJudge(**run.judge_result),
        model=run.model,
        input_tokens=run.input_tokens,
        output_tokens=run.output_tokens,
        duration_ms=run.duration_ms,
        created_at=datetime_to_timestamp(run.created_at),
        rule_version_ids=run.snapshot["rule_version_ids"],
        outcome_reason=run.observations.get("reason") or "",
    )
    if run.completed_at:
        result.completed_at = datetime_to_timestamp(run.completed_at)
    for field in ("skill_id", "skill_version_id", "draft_id", "run_log_id"):
        value = getattr(run, field)
        if value is not None:
            setattr(result, field, str(value))
    if run.cost is not None:
        result.cost = str(run.cost)
    if run.cost_currency is not None:
        result.cost_currency = run.cost_currency
    return result
