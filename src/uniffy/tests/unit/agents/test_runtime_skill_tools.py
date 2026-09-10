"""Runtime schemas cannot expose model-side skill discovery."""

from uniffy.domains.agents.providers.base import ToolCall
from uniffy.domains.agents.runtime.tooling import resolve_tool_schemas
from uniffy.domains.agents.tools.definitions import ToolContext
from uniffy.domains.agents.tools.executor import ToolExecutor
from uniffy.domains.agents.tools.registry import get_tool_registry, to_api_name
from uniffy.core.types import generate_id
from unittest.mock import AsyncMock


def test_schemas_contain_only_selected_registered_tools() -> None:
    schemas = resolve_tool_schemas(get_tool_registry(), ["search.query"])
    assert schemas is not None
    assert [schema["name"] for schema in schemas] == [to_api_name("search.query")]


def test_empty_selection_advertises_no_tools() -> None:
    assert resolve_tool_schemas(get_tool_registry(), []) is None


async def test_model_cannot_load_skill_instructions_with_a_tool() -> None:
    registry = get_tool_registry()
    context = ToolContext(
        session=AsyncMock(),
        user_id=generate_id(),
        organization_id=generate_id(),
        agent_id=generate_id(),
        allowed_tools=frozenset({"skills.view_skill"}),
    )
    result = await ToolExecutor(registry, context).execute(
        ToolCall(id="call", name=to_api_name("skills.view_skill"), input={"name": "report"})
    )
    assert not result.success
    assert registry.get("skills.view_skill") is None
    assert resolve_tool_schemas(registry, ["skills.view_skill"]) is None
