from unittest.mock import AsyncMock

import pytest

from uniffy.core.errors import ValidationError
from uniffy.core.json_codec import dumps_str
from uniffy.core.models.agents.skill_evaluation_run import SkillEvaluationStatus
from uniffy.domains.agents.providers.base import CompletionResult, ToolCall
from uniffy.domains.agents.skills.evaluations.runner import evaluate, judge
from uniffy.domains.agents.skills.evaluations.schemas import CaseFields, EvaluationIssue
from uniffy.domains.agents.skills.evaluations import schemas
from uniffy.domains.agents.tools.builtin.registration import register_all
from uniffy.domains.agents.tools.executor import ToolExecutor
from uniffy.domains.agents.tools.registry import ToolRegistry, to_api_name


@pytest.fixture
def evaluation_registry(monkeypatch):
    registry = ToolRegistry()
    register_all(registry)
    monkeypatch.setattr(schemas, "get_tool_registry", lambda: registry)


@pytest.mark.parametrize(
    "changes",
    [
        {"input": "x" * 12001},
        {"rubric": "x" * 4001},
        {"name": " "},
        {"expected_tools": ["unknown.tool"]},
        {"expected_tools": ["tools.load_group"]},
        {"expected_tools": ["notes-create_note"]},
        {"expected_tools": ["memory.save"], "forbidden_tools": ["memory.save"]},
        {"fixtures": [{"tool_name": "memory.save", "response": "x" * 4001}]},
        {"fixtures": [{"tool_name": "memory.save", "response": ""}] * 2},
    ],
)
def test_evaluation_case_bounds_and_tool_names(evaluation_registry, changes):
    with pytest.raises(ValidationError):
        schemas.clean_case_fields({"name": "Report", "input": "Write report", **changes})


def test_evaluation_case_sanitizes_text_and_bounds_aggregate_fixtures(evaluation_registry):
    fields = schemas.clean_case_fields({
        "name": " Report\x00 ",
        "input": "Write\x07 report",
        "expected_tools": ["memory.save", "memory.save"],
        "fixtures": [{"tool_name": "memory.save", "response": " sample\x00 "}],
    })
    assert fields.name == "Report"
    assert fields.input == "Write report"
    assert fields.expected_tools == ["memory.save"]
    assert fields.fixtures[0].response == "sample"
    with pytest.raises(ValidationError, match="limit"):
        schemas.clean_case_fields({
            "name": "Report",
            "input": "Write report",
            "fixtures": [
                {"tool_name": name, "response": "x" * 4000}
                for name in [
                    "memory.save",
                    "memory.read",
                    "memory.forget",
                    "notes.create_note",
                    "notes.read_note",
                    "notes.delete_note",
                ]
            ],
        })


@pytest.mark.parametrize(
    "name",
    [
        "memory.save",
        "memory.forget",
        "notes.read_note",
        "notes.create_note",
        "files.delete_file",
        "projects.create_project",
        "github.create_issue",
        "images.generate",
    ],
)
async def test_evaluation_tool_calls_can_only_receive_fixtures(name, monkeypatch):
    real_executor = AsyncMock(side_effect=AssertionError("Real tools are forbidden"))
    monkeypatch.setattr(ToolExecutor, "execute", real_executor)
    case = CaseFields(
        name="Fixture case",
        input="Do the work",
        expected_tools=[name],
        fixtures=[{"tool_name": name, "response": "Fixture response"}],
    )
    complete = AsyncMock(
        side_effect=[
            CompletionResult(
                content="Working",
                model="test",
                tool_calls=[ToolCall(id="call", name=to_api_name(name), input={"value": "fixture"})],
                thinking_blocks=[{"type": "thinking", "thinking": "Private", "signature": "sig"}],
            ),
            CompletionResult(content="Done", model="test"),
        ]
    )
    result = await evaluate(
        complete,
        case=case,
        system_prompt="Selected rules and skill",
        schemas=[{"name": to_api_name(name)}],
    )
    assert result.status == SkillEvaluationStatus.PASSED
    assert result.observations["tool_attempts"][0]["fixture_used"]
    assert complete.call_args.args[0][-1]["content"][0]["content"] == "Fixture response"
    assert complete.call_args.args[0][-2]["content"][0]["signature"] == "sig"
    assert "Private" not in dumps_str(result.observations)
    real_executor.assert_not_awaited()


@pytest.mark.parametrize(
    ("fixtures", "forbidden", "schemas", "status", "reason"),
    [
        (
            [],
            [],
            [{"name": "notes-read_note"}],
            SkillEvaluationStatus.INCONCLUSIVE,
            EvaluationIssue.MISSING_FIXTURE,
        ),
        (
            [],
            ["notes.read_note"],
            [{"name": "notes-read_note"}],
            SkillEvaluationStatus.FAILED,
            EvaluationIssue.FORBIDDEN_TOOL,
        ),
        (
            [{"tool_name": "notes.read_note", "response": "Fixture"}],
            [],
            [],
            SkillEvaluationStatus.FAILED,
            EvaluationIssue.UNAVAILABLE_TOOL,
        ),
    ],
)
async def test_forbidden_unavailable_and_unfixtured_calls_never_fall_through(
    fixtures, forbidden, schemas, status, reason, monkeypatch
):
    executor = AsyncMock(side_effect=AssertionError("Real tools are forbidden"))
    monkeypatch.setattr(ToolExecutor, "execute", executor)
    complete = AsyncMock(
        side_effect=[
            CompletionResult(
                content="",
                model="test",
                tool_calls=[ToolCall(id="call", name="notes-read_note", input={})],
            ),
            CompletionResult(content="Result", model="test"),
        ]
    )
    result = await evaluate(
        complete,
        case=CaseFields(
            name="Case",
            input="Input",
            expected_tools=[] if forbidden else ["notes.read_note"],
            forbidden_tools=forbidden,
            fixtures=fixtures,
        ),
        system_prompt="System",
        schemas=schemas,
    )
    assert result.status == status
    assert result.observations["reason"] == reason
    executor.assert_not_awaited()


async def test_missing_expected_tool_fails_and_empty_assertions_are_inconclusive():
    complete = AsyncMock(return_value=CompletionResult(content="Answer", model="test"))
    result = await evaluate(
        complete,
        case=CaseFields(name="Case", input="Input", expected_tools=["notes.read_note"]),
        system_prompt="System",
        schemas=[],
    )
    assert result.status == SkillEvaluationStatus.FAILED
    assert result.observations["reason"] == EvaluationIssue.MISSING_EXPECTED_TOOL
    result = await evaluate(
        complete, case=CaseFields(name="Case", input="Input"), system_prompt="System", schemas=[]
    )
    assert result.status == SkillEvaluationStatus.INCONCLUSIVE
    assert result.observations["reason"] == EvaluationIssue.NO_ASSERTIONS


@pytest.mark.parametrize(
    "response", ["not json", '{"score":true,"rationale":"bad"}', '{"score":2,"rationale":"bad"}']
)
async def test_invalid_optional_judge_keeps_deterministic_observations(response):
    case = CaseFields(
        name="Case", input="Input", rubric="Be concise", forbidden_tools=["notes.delete_note"]
    )
    result = await evaluate(
        AsyncMock(return_value=CompletionResult(content="Answer", model="test")),
        case=case,
        system_prompt="System",
        schemas=[],
    )
    judge_complete = AsyncMock(return_value=CompletionResult(content=response, model="judge"))
    score = await judge(judge_complete, case=case, result=result)
    assert score == {"status": "error", "error": "invalid_response"}
    assert result.status == SkillEvaluationStatus.PASSED
    assert judge_complete.call_args.args[2] == []


async def test_tool_loop_is_bounded_and_does_not_report_a_partial_answer_as_passed():
    case = CaseFields(
        name="Case",
        input="Input",
        expected_tools=["notes.read_note"],
        fixtures=[{"tool_name": "notes.read_note", "response": "Fixture"}],
    )
    complete = AsyncMock(
        return_value=CompletionResult(
            content="Still working",
            model="test",
            tool_calls=[ToolCall(id="call", name="notes-read_note", input={})],
        )
    )
    result = await evaluate(
        complete, case=case, system_prompt="System", schemas=[{"name": "notes-read_note"}]
    )
    assert complete.await_count == 5
    assert result.status == SkillEvaluationStatus.INCONCLUSIVE
