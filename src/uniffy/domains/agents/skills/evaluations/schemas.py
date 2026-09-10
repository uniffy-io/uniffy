from enum import StrEnum
from hashlib import sha256

from pydantic import BaseModel, ConfigDict, Field
from pydantic import ValidationError as ModelValidationError

from uniffy.core.errors import ValidationError
from uniffy.core.json_codec import dumps_bytes
from uniffy.domains.agents.skills.validation import sanitize_skill_text
from uniffy.domains.agents.tools.registry import get_tool_registry

MAX_CASES = 25
MAX_OPEN_RUNS = 50
MAX_FIXTURE_CHARACTERS = 20000
MAX_PROMPT_CHARACTERS = 100000
MAX_OUTPUT_CHARACTERS = 20000
MAX_TOOL_ARGUMENT_CHARACTERS = 8000
MAX_TOOL_CALLS = 40
MAX_TOOL_ROUNDS = 5
EVALUATION_TIMEOUT_SECONDS = 300
EVALUATION_QUEUE_SECONDS = 900


class AssertionKind(StrEnum):
    EXPECTED = "expected"
    FORBIDDEN = "forbidden"


class EvaluationIssue(StrEnum):
    FORBIDDEN_TOOL = "forbidden_tool"
    UNAVAILABLE_TOOL = "unavailable_tool"
    MISSING_FIXTURE = "missing_fixture"
    TOOL_LIMIT = "tool_limit"
    NO_ASSERTIONS = "no_assertions"
    MISSING_EXPECTED_TOOL = "missing_expected_tool"
    INCOMPLETE_OUTPUT = "incomplete_output"


class JudgeStatus(StrEnum):
    NOT_REQUESTED = "not_requested"
    COMPLETED = "completed"
    ERROR = "error"


class ToolFixture(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    tool_name: str = Field(min_length=1, max_length=128)
    response: str = Field(max_length=4000)
    is_error: bool = False


class CaseFields(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    name: str = Field(min_length=1, max_length=255)
    input: str = Field(min_length=1, max_length=12000)
    rubric: str = Field(default="", max_length=4000)
    expected_tools: list[str] = Field(default_factory=list, max_length=50)
    forbidden_tools: list[str] = Field(default_factory=list, max_length=50)
    fixtures: list[ToolFixture] = Field(default_factory=list, max_length=50)


def clean_case_fields(values: dict) -> CaseFields:
    normalized = {
        **values,
        "name": sanitize_skill_text(values.get("name", "")),
        "input": sanitize_skill_text(values.get("input", "")),
        "rubric": sanitize_skill_text(values.get("rubric", "")),
    }
    try:
        result = CaseFields.model_validate(normalized)
    except ModelValidationError as exc:
        raise ValidationError("case", "Evaluation case fields exceed their allowed bounds") from exc
    if set(result.expected_tools) & set(result.forbidden_tools):
        raise ValidationError("tools", "A tool cannot be both expected and forbidden")
    fixture_names = [fixture.tool_name for fixture in result.fixtures]
    if len(fixture_names) != len(set(fixture_names)):
        raise ValidationError("fixtures", "Provide one response per tool")
    if sum(len(fixture.response) for fixture in result.fixtures) > MAX_FIXTURE_CHARACTERS:
        raise ValidationError("fixtures", "Tool responses exceed the evaluation limit")
    registry = get_tool_registry()
    for name in {*result.expected_tools, *result.forbidden_tools, *fixture_names}:
        definition = registry.get(name)
        if definition is None or definition.internal or definition.name != name:
            raise ValidationError("tools", "Select a known workspace tool")
    return result.model_copy(
        update={
            "expected_tools": list(dict.fromkeys(result.expected_tools)),
            "forbidden_tools": list(dict.fromkeys(result.forbidden_tools)),
            "fixtures": [
                fixture.model_copy(update={"response": sanitize_skill_text(fixture.response)})
                for fixture in result.fixtures
            ],
        }
    )


def snapshot_digest(value: dict) -> str:
    return sha256(dumps_bytes(value)).hexdigest()
