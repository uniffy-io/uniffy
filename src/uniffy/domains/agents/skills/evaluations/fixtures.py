from dataclasses import asdict, dataclass

from uniffy.core.errors import ValidationError
from uniffy.core.json_codec import dumps_str
from uniffy.domains.agents.providers.base import ToolCall
from uniffy.domains.agents.skills.evaluations.schemas import (
    MAX_TOOL_ARGUMENT_CHARACTERS,
    MAX_TOOL_CALLS,
    CaseFields,
    EvaluationIssue,
)
from uniffy.domains.agents.tools.registry import from_api_name


@dataclass(frozen=True)
class FixtureResult:
    tool_name: str
    input_json: str
    fixture_response: str
    fixture_used: bool
    issue: EvaluationIssue | None = None
    is_error: bool = False


class FixtureExecutor:
    """The evaluator receives no session, domain operations, or executable tool registry."""

    def __init__(self, case: CaseFields, schemas: list[dict]) -> None:
        self.allowed = frozenset(from_api_name(schema["name"]) for schema in schemas)
        self.fixtures = {fixture.tool_name: fixture for fixture in case.fixtures}
        self.forbidden = frozenset(case.forbidden_tools)
        self.attempts: list[FixtureResult] = []

    def execute(self, call: ToolCall) -> FixtureResult:
        if len(self.attempts) >= MAX_TOOL_CALLS:
            raise ValidationError("evaluation", "Evaluation exceeded its tool-call limit")
        arguments = dumps_str(call.input)
        if len(arguments) > MAX_TOOL_ARGUMENT_CHARACTERS:
            raise ValidationError("evaluation", "Evaluation tool arguments exceeded their limit")
        name = from_api_name(call.name)
        if name in self.forbidden:
            issue = EvaluationIssue.FORBIDDEN_TOOL
        elif name not in self.allowed:
            issue = EvaluationIssue.UNAVAILABLE_TOOL
        elif name not in self.fixtures:
            issue = EvaluationIssue.MISSING_FIXTURE
        else:
            issue = None
        fixture = self.fixtures.get(name) if issue is None else None
        result = FixtureResult(
            tool_name=name,
            input_json=arguments,
            fixture_response=fixture.response if fixture else "No tool response is available.",
            fixture_used=fixture is not None,
            issue=issue,
            is_error=fixture.is_error if fixture else True,
        )
        self.attempts.append(result)
        return result

    def observations(self) -> list[dict]:
        return [asdict(attempt) for attempt in self.attempts]
