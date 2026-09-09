from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from uniffy.core.data_files import DATA_DIR
from uniffy.core.errors import ValidationError
from uniffy.core.json_codec import JSONDecodeError, dumps_str, loads
from uniffy.core.models.agents.skill_evaluation_run import SkillEvaluationStatus
from uniffy.domains.agents.providers.base import CompletionResult, CompletionStopReason
from uniffy.domains.agents.skills.evaluations.fixtures import FixtureExecutor
from uniffy.domains.agents.skills.evaluations.schemas import (
    MAX_OUTPUT_CHARACTERS,
    MAX_TOOL_ROUNDS,
    AssertionKind,
    CaseFields,
    EvaluationIssue,
    JudgeStatus,
)

Completion = Callable[[list[dict], str, list[dict]], Awaitable[CompletionResult]]
JUDGE_PROMPT = (DATA_DIR / "prompts" / "skill-evaluation-judge.md").read_text(encoding="utf-8")


@dataclass(frozen=True)
class EvaluationResult:
    status: SkillEvaluationStatus
    output: str
    observations: dict


def assess(
    case: CaseFields, executor: FixtureExecutor, output: str, incomplete: bool
) -> EvaluationResult:
    observed = {attempt.tool_name for attempt in executor.attempts}
    assertions = [
        {"tool_name": name, "kind": AssertionKind.EXPECTED, "passed": name in observed}
        for name in case.expected_tools
    ] + [
        {"tool_name": name, "kind": AssertionKind.FORBIDDEN, "passed": name not in observed}
        for name in case.forbidden_tools
    ]
    issues = {attempt.issue for attempt in executor.attempts if attempt.issue is not None}
    if any(not assertion["passed"] for assertion in assertions):
        status = SkillEvaluationStatus.FAILED
        reason = (
            EvaluationIssue.FORBIDDEN_TOOL
            if observed & set(case.forbidden_tools)
            else EvaluationIssue.MISSING_EXPECTED_TOOL
        )
    elif EvaluationIssue.UNAVAILABLE_TOOL in issues:
        status, reason = SkillEvaluationStatus.FAILED, EvaluationIssue.UNAVAILABLE_TOOL
    elif EvaluationIssue.MISSING_FIXTURE in issues:
        status, reason = SkillEvaluationStatus.INCONCLUSIVE, EvaluationIssue.MISSING_FIXTURE
    elif incomplete or not output:
        status, reason = SkillEvaluationStatus.INCONCLUSIVE, EvaluationIssue.INCOMPLETE_OUTPUT
    elif not assertions:
        status, reason = SkillEvaluationStatus.INCONCLUSIVE, EvaluationIssue.NO_ASSERTIONS
    else:
        status, reason = SkillEvaluationStatus.PASSED, None
    return EvaluationResult(
        status=status,
        output=output,
        observations={
            "tool_attempts": executor.observations(),
            "assertions": assertions,
            "reason": reason,
        },
    )


async def evaluate(
    complete: Completion, *, case: CaseFields, system_prompt: str, schemas: list[dict]
) -> EvaluationResult:
    executor = FixtureExecutor(case, schemas)
    messages: list[dict] = [{"role": "user", "content": case.input}]
    output = ""
    for _ in range(MAX_TOOL_ROUNDS):
        result = await complete(messages, system_prompt, schemas)
        if not isinstance(result, CompletionResult) or len(result.content) > MAX_OUTPUT_CHARACTERS:
            raise ValidationError(
                "evaluation", "The provider returned an invalid evaluation response"
            )
        output = result.content
        if not result.tool_calls:
            return assess(
                case,
                executor,
                output,
                result.stop_reason == CompletionStopReason.MAX_TOKENS,
            )
        assistant: list[dict] = [*result.thinking_blocks]
        if output:
            assistant.append({"type": "text", "text": output})
        responses = []
        for call in result.tool_calls:
            response = executor.execute(call)
            block = {"type": "tool_use", "id": call.id, "name": call.name, "input": call.input}
            if call.metadata:
                block["metadata"] = call.metadata
            assistant.append(block)
            responses.append({
                "type": "tool_result",
                "tool_use_id": call.id,
                "tool_name": call.name,
                "content": response.fixture_response,
                "is_error": response.is_error,
            })
        messages.extend([
            {"role": "assistant", "content": assistant},
            {"role": "user", "content": responses},
        ])
    return assess(case, executor, output, True)


async def judge(complete: Completion, *, case: CaseFields, result: EvaluationResult) -> dict:
    response = await complete(
        [
            {
                "role": "user",
                "content": dumps_str({
                    "input": case.input,
                    "rubric": case.rubric,
                    "output": result.output,
                    "observations": result.observations,
                }),
            }
        ],
        JUDGE_PROMPT,
        [],
    )
    try:
        if (
            not isinstance(response, CompletionResult)
            or response.tool_calls
            or len(response.content) > 5000
        ):
            raise ValueError
        parsed = loads(response.content)
        if not isinstance(parsed, dict) or set(parsed) != {"score", "rationale"}:
            raise ValueError
        score, rationale = parsed["score"], parsed["rationale"]
        if (
            isinstance(score, bool)
            or not isinstance(score, (int, float))
            or not 0 <= score <= 1
            or not isinstance(rationale, str)
            or len(rationale) > 2000
        ):
            raise ValueError
        return {"status": JudgeStatus.COMPLETED, "score": score, "rationale": rationale}
    except JSONDecodeError, ValueError, TypeError:
        return {"status": JudgeStatus.ERROR, "error": "invalid_response"}
