"""Deferred tool advertisement: planning, the load_group tool, loop expansion.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.errors import ValidationError
from uniffy.core.types import generate_id
from uniffy.domains.agents.providers.base import CompletionResult, ToolCall
from uniffy.domains.agents.runtime.operations import (
    MAX_LOAD_ONLY_ITERATIONS,
    RuntimeOperations,
    _expand_loaded_schemas,
    _is_load_only_turn,
)
from uniffy.domains.agents.runtime.prompt import build_system_prompt
from uniffy.domains.agents.tools.builtin.discovery import load_group, load_group_tool
from uniffy.domains.agents.tools.deferral import (
    LOAD_GROUP_TOOL,
    LOADED_GROUPS_METADATA_KEY,
    plan_tool_advertisement,
)
from uniffy.domains.agents.tools.definitions import (
    ToolContext,
    ToolDefinition,
    ToolResult,
)
from uniffy.domains.agents.tools.executor import ToolExecutor
from uniffy.domains.agents.tools.registry import ToolRegistry, to_api_name

LOAD_API_NAME = to_api_name(LOAD_GROUP_TOOL)


def _tool(name: str, group: str, *, internal: bool = False) -> ToolDefinition:
    async def _noop(ctx, args):
        return ToolResult(success=True, data="ok")

    return ToolDefinition(
        name=name,
        description=f"description of {name}",
        parameter_schema={"type": "object", "properties": {}},
        executor=_noop,
        group=group,
        internal=internal,
    )


def _registry() -> ToolRegistry:
    registry = ToolRegistry()
    registry.register(_tool("memory.save", "Memory"))
    registry.register(_tool("search.query", "Search"))
    registry.register(_tool("skills.view_skill", "Skills", internal=True))
    for i in range(8):
        registry.register(_tool(f"notes.tool_{i}", "Notes"))
    for i in range(8):
        registry.register(_tool(f"calendar.tool_{i}", "Calendar"))
    registry.register(load_group_tool)
    return registry


_ALL_TOOLS = [
    "memory.save",
    "search.query",
    "skills.view_skill",
    *[f"notes.tool_{i}" for i in range(8)],
    *[f"calendar.tool_{i}" for i in range(8)],
]


def _names(schemas: list[dict]) -> list[str]:
    return [s["name"] for s in schemas]


class TestPlanToolAdvertisement:
    def test_small_sets_are_advertised_whole(self) -> None:
        registry = _registry()
        schemas = registry.get_anthropic_schemas(["memory.save", "notes.tool_0"])
        plan = plan_tool_advertisement(registry, schemas, [])
        assert _names(plan.tool_schemas) == ["memory-save", "notes-tool_0"]
        assert plan.deferred == {}

    def test_core_and_internal_advertised_rest_deferred(self) -> None:
        registry = _registry()
        schemas = registry.get_anthropic_schemas(_ALL_TOOLS)
        plan = plan_tool_advertisement(registry, schemas, [])
        assert _names(plan.tool_schemas) == [
            "memory-save",
            "search-query",
            "skills-view_skill",
            LOAD_API_NAME,
        ]
        assert list(plan.deferred) == ["Notes", "Calendar"]
        assert len(plan.deferred["Notes"]) == 8
        assert plan.deferred_names()["Notes"][0] == "notes.tool_0"

    def test_loaded_group_appends_after_core_block(self) -> None:
        registry = _registry()
        schemas = registry.get_anthropic_schemas(_ALL_TOOLS)
        plan = plan_tool_advertisement(registry, schemas, ["calendar"])
        names = _names(plan.tool_schemas)
        assert names[:4] == [
            "memory-save",
            "search-query",
            "skills-view_skill",
            LOAD_API_NAME,
        ]
        assert names[4:] == [f"calendar-tool_{i}" for i in range(8)]
        assert list(plan.deferred) == ["Notes"]

    def test_unknown_loaded_label_is_ignored(self) -> None:
        registry = _registry()
        schemas = registry.get_anthropic_schemas(_ALL_TOOLS)
        plan = plan_tool_advertisement(registry, schemas, ["Gone"])
        assert list(plan.deferred) == ["Notes", "Calendar"]

    def test_all_groups_loaded_keeps_load_tool_advertised(self) -> None:
        registry = _registry()
        schemas = registry.get_anthropic_schemas(_ALL_TOOLS)
        plan = plan_tool_advertisement(registry, schemas, ["Notes", "Calendar"])
        assert LOAD_API_NAME in _names(plan.tool_schemas)
        assert plan.deferred == {}


class TestPromptToolSection:
    def test_no_per_tool_descriptions_for_advertised_tools(self) -> None:
        prompt = build_system_prompt(agent_name="A", soul_prompt="", org_name="Org")
        assert "### Tools" not in prompt
        assert "More tools available on demand" not in prompt

    def test_deferred_index_lists_groups_and_names(self) -> None:
        prompt = build_system_prompt(
            agent_name="A",
            soul_prompt="",
            org_name="Org",
            deferred_tools={"Calendar": ["calendar.tool_0", "calendar.tool_1"]},
        )
        assert "More tools available on demand" in prompt
        assert LOAD_API_NAME in prompt
        assert "- Calendar (2 tools): calendar.tool_0, calendar.tool_1" in prompt
        # Names only: descriptions stay out of the index.
        assert "description of" not in prompt


def _ctx(**overrides) -> ToolContext:
    defaults = dict(
        session=AsyncMock(),
        user_id=generate_id(),
        organization_id=generate_id(),
        agent_id=generate_id(),
        session_id=generate_id(),
        deferred_tool_groups={"Notes": ["notes.tool_0", "notes.tool_1"]},
        loaded_tool_groups=[],
    )
    defaults.update(overrides)
    return ToolContext(**defaults)


class TestLoadGroupTool:
    async def test_missing_argument(self) -> None:
        result = await load_group(_ctx(), {})
        assert not result.success
        assert "group" in result.error

    async def test_unknown_group_lists_loadable(self) -> None:
        result = await load_group(_ctx(), {"group": "Files"})
        assert not result.success
        assert "Notes" in result.error

    async def test_load_is_case_insensitive_and_mutates_context(self) -> None:
        ctx = _ctx()
        result = await load_group(ctx, {"group": "notes"})
        assert result.success
        assert result.metadata == {LOADED_GROUPS_METADATA_KEY: ["Notes"]}
        assert ctx.loaded_tool_groups == ["Notes"]
        assert ctx.deferred_tool_groups == {}
        assert "notes-tool_0" in result.data
        ctx.session.execute.assert_awaited()

    async def test_second_load_is_idempotent(self) -> None:
        ctx = _ctx()
        await load_group(ctx, {"group": "Notes"})
        again = await load_group(ctx, {"group": "Notes"})
        assert again.success
        assert again.metadata is None
        assert "already loaded" in again.data

    async def test_channel_destination_persists_via_binding_upsert(self) -> None:
        ctx = _ctx(session_id=None, channel_id=generate_id())
        result = await load_group(ctx, {"group": "Notes"})
        assert result.success
        ctx.session.execute.assert_awaited()


class TestLoopHelpers:
    def test_is_load_only_turn(self) -> None:
        load_call = ToolCall(id="1", name=LOAD_API_NAME, input={"group": "Notes"})
        other = ToolCall(id="2", name="notes-tool_0", input={})
        assert _is_load_only_turn([load_call])
        assert not _is_load_only_turn([load_call, other])
        assert not _is_load_only_turn([])

    def test_expand_pops_pool_and_extends_schemas(self) -> None:
        schemas = [{"name": LOAD_API_NAME}]
        pool = {"Notes": [{"name": "notes-tool_0"}]}
        results = {
            "1": ToolResult(
                success=True,
                data="",
                metadata={LOADED_GROUPS_METADATA_KEY: ["Notes"]},
            ),
            "2": ToolResult(success=True, data="no metadata"),
        }
        _expand_loaded_schemas(schemas, pool, results)
        assert _names(schemas) == [LOAD_API_NAME, "notes-tool_0"]
        assert pool == {}
        # A second pass with the same results is a no-op.
        _expand_loaded_schemas(schemas, pool, results)
        assert _names(schemas) == [LOAD_API_NAME, "notes-tool_0"]


def _loop_ops() -> RuntimeOperations:
    ops = RuntimeOperations.__new__(RuntimeOperations)
    ops._session_ops = MagicMock(add_message=AsyncMock(return_value=MagicMock()))
    return ops


class TestRunToolLoopExpansion:
    async def test_load_call_expands_schemas_for_next_iteration(self, monkeypatch) -> None:
        import uniffy.domains.agents.tools.executor as executor_mod

        monkeypatch.setattr(executor_mod, "write_audit_event", AsyncMock())

        async def scenario():
            registry = _registry()
            schemas = registry.get_anthropic_schemas(_ALL_TOOLS)
            plan = plan_tool_advertisement(registry, schemas, [])
            ctx = _ctx(deferred_tool_groups=plan.deferred_names())
            executor = ToolExecutor(registry, ctx)

            seen_tools: list[list[str]] = []

            class Provider:
                async def chat_completion(self, **kwargs):
                    seen_tools.append(_names(kwargs["tools"]))
                    return CompletionResult(content="done", model="m")

            initial = CompletionResult(
                content="",
                model="m",
                stop_reason="tool_use",
                tool_calls=[
                    ToolCall(id="t1", name=LOAD_API_NAME, input={"group": "Notes"})
                ],
            )
            result = await _loop_ops()._run_tool_loop(
                user_id=ctx.user_id,
                organization_id=ctx.organization_id,
                session_id=ctx.session_id,
                agent_id=ctx.agent_id,
                provider=Provider(),
                model="m",
                system_prompt="s",
                tool_schemas=plan.tool_schemas,
                llm_messages=[],
                result=initial,
                executor=executor,
                deferred_pool=dict(plan.deferred),
            )
            assert result.content == "done"
            assert "notes-tool_0" in seen_tools[0]
            assert "calendar-tool_0" not in seen_tools[0]

        await scenario()

    async def test_load_only_iterations_are_capped(self, monkeypatch) -> None:
        import uniffy.domains.agents.tools.executor as executor_mod

        monkeypatch.setattr(executor_mod, "write_audit_event", AsyncMock())

        async def scenario():
            registry = _registry()
            schemas = registry.get_anthropic_schemas(_ALL_TOOLS)
            plan = plan_tool_advertisement(registry, schemas, [])
            ctx = _ctx(deferred_tool_groups=plan.deferred_names())
            executor = ToolExecutor(registry, ctx)

            def _load_result(n: int) -> CompletionResult:
                return CompletionResult(
                    content="",
                    model="m",
                    stop_reason="tool_use",
                    tool_calls=[
                        ToolCall(
                            id=f"t{n}",
                            name=LOAD_API_NAME,
                            input={"group": "Notes"},
                        )
                    ],
                )

            counter = {"n": 0}

            class Provider:
                async def chat_completion(self, **kwargs):
                    counter["n"] += 1
                    return _load_result(counter["n"])

            with pytest.raises(ValidationError):
                await _loop_ops()._run_tool_loop(
                    user_id=ctx.user_id,
                    organization_id=ctx.organization_id,
                    session_id=ctx.session_id,
                    agent_id=ctx.agent_id,
                    provider=Provider(),
                    model="m",
                    system_prompt="s",
                    tool_schemas=plan.tool_schemas,
                    llm_messages=[],
                    result=_load_result(0),
                    executor=executor,
                    deferred_pool=dict(plan.deferred),
                )
            assert counter["n"] == MAX_LOAD_ONLY_ITERATIONS

        await scenario()
