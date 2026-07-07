"""Tests for skill-driven tool schema resolution and the view_skill lookup.

Vanilla pytest + ``asyncio.run`` and mocks, matching the repo's agents tests
(no pytest-asyncio, no live DB).
"""

import asyncio
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from uniffy.core.models.agents.skill import AgentSkill
from uniffy.domains.agents.runtime.operations import _resolve_tool_schemas
from uniffy.domains.agents.runtime.prompt import (
    SKILL_VIEW_TOOL,
    build_system_prompt,
    to_skill_prompt_entry,
)
from uniffy.domains.agents.tools.registry import get_tool_registry, to_api_name

_VIEW_API_NAME = to_api_name(SKILL_VIEW_TOOL)


def _run(coro):
    return asyncio.run(coro)


def _skill(**kw) -> NS:
    base = dict(
        id=uuid4(),
        name="report",
        display_name="Report",
        description="",
        when_to_use="",
        content="BODY",
        always_active=False,
    )
    base.update(kw)
    return NS(**base)


def _schema_names(schemas) -> set[str]:
    return {s["name"] for s in (schemas or [])}


class TestResolveToolSchemas:
    def test_view_skill_appended_when_advertised_skill_present(self) -> None:
        registry = get_tool_registry()
        entries = [to_skill_prompt_entry(_skill(name="report", always_active=False))]

        schemas = _resolve_tool_schemas(registry, ["search.query"], entries, None)

        names = _schema_names(schemas)
        assert _VIEW_API_NAME in names  # the advertised index can now be loaded
        assert to_api_name("search.query") in names  # enabled tools still present

    def test_view_skill_appended_even_without_enabled_tools(self) -> None:
        registry = get_tool_registry()
        entries = [to_skill_prompt_entry(_skill(name="report"))]

        schemas = _resolve_tool_schemas(registry, [], entries, None)

        assert _schema_names(schemas) == {_VIEW_API_NAME}

    def test_no_view_skill_without_any_skills(self) -> None:
        registry = get_tool_registry()

        schemas = _resolve_tool_schemas(registry, ["search.query"], [], None)

        assert _VIEW_API_NAME not in _schema_names(schemas)

    def test_no_view_skill_when_only_always_active(self) -> None:
        registry = get_tool_registry()
        entries = [to_skill_prompt_entry(_skill(name="daily", always_active=True))]

        schemas = _resolve_tool_schemas(registry, ["search.query"], entries, None)

        assert _VIEW_API_NAME not in _schema_names(schemas)

    def test_no_view_skill_when_only_advertised_is_invoked(self) -> None:
        registry = get_tool_registry()
        invoked = to_skill_prompt_entry(_skill(name="report", always_active=False))

        schemas = _resolve_tool_schemas(registry, [], [invoked], invoked)

        assert _VIEW_API_NAME not in _schema_names(schemas)

    def test_view_skill_present_when_advertised_alongside_invoked(self) -> None:
        registry = get_tool_registry()
        invoked = to_skill_prompt_entry(_skill(name="report"))
        other = to_skill_prompt_entry(_skill(name="other"))

        schemas = _resolve_tool_schemas(registry, [], [invoked, other], invoked)

        assert _VIEW_API_NAME in _schema_names(schemas)

    def test_view_skill_not_duplicated_when_already_enabled(self) -> None:
        registry = get_tool_registry()
        entries = [to_skill_prompt_entry(_skill(name="report"))]

        schemas = _resolve_tool_schemas(registry, [SKILL_VIEW_TOOL], entries, None)

        names = [s["name"] for s in schemas]
        assert names.count(_VIEW_API_NAME) == 1


class TestViewSkillExecutionWithoutEnabledTool:
    """view_skill executes via the registry regardless of ``agent.enabled_tools``."""

    def _ctx(self):
        return NS(
            session=MagicMock(),
            user_id=uuid4(),
            organization_id=uuid4(),
            agent_id=uuid4(),
            session_id=uuid4(),
        )

    def _patch(self, monkeypatch, skills):
        import uniffy.domains.agents.cache as cache_mod
        import uniffy.domains.agents.skills.operations as ops_mod
        import uniffy.domains.agents.skills.usage as usage_mod

        # The agent does NOT list view_skill in enabled_skills/enabled_tools -
        # the tool still resolves through the shared registry.
        monkeypatch.setattr(
            cache_mod, "fetch_agent_row", AsyncMock(return_value=NS(enabled_skills=[]))
        )
        fake_ops = MagicMock()
        fake_ops.get_skills_for_agent = AsyncMock(return_value=skills)
        monkeypatch.setattr(ops_mod, "SkillOperations", lambda _session: fake_ops)

        async def _record(_session, **kw):
            return None

        monkeypatch.setattr(usage_mod, "record_skill_event", _record)

    def test_view_skill_is_registered_and_read_only(self) -> None:
        registry = get_tool_registry()
        tool = registry.get(SKILL_VIEW_TOOL)
        assert tool is not None
        assert tool.read_only is True

    def test_execute_returns_content_when_not_in_enabled_tools(self, monkeypatch) -> None:
        from uniffy.domains.agents.tools.builtin.skills import _execute_view_skill

        skill = AgentSkill(
            id=uuid4(),
            organization_id=uuid4(),
            name="report",
            display_name="Report",
            source="organization",
            content="THE INSTRUCTIONS",
            latest_version_number=2,
        )
        self._patch(monkeypatch, [skill])

        result = _run(_execute_view_skill(self._ctx(), {"name": "report"}))

        assert result.success
        assert "THE INSTRUCTIONS" in result.data


class TestNameCollisionShadowing:
    """Org and bundled skills can legally share a name (two partial unique indexes)."""

    def test_advertised_index_keeps_same_named_org_skill_when_bundled_invoked(self) -> None:
        org_always = to_skill_prompt_entry(
            _skill(name="report", always_active=True, content="ORG_ALWAYS_CONTENT")
        )
        bundled = to_skill_prompt_entry(
            _skill(name="report", always_active=False, content="BUNDLED_CONTENT")
        )

        prompt = build_system_prompt(
            agent_name="A",
            soul_prompt="soul",
            org_name="Org",
            skills=[org_always, bundled],
            invoked_skill=bundled,
        )

        # id-based dedupe keeps the distinct org skill; its always-active content
        # is still injected instead of being dropped by the name collision.
        assert "ORG_ALWAYS_CONTENT" in prompt
        assert "BUNDLED_CONTENT" in prompt  # invoked skill rendered in full

    def test_view_skill_prefers_org_over_bundled_on_name_collision(self, monkeypatch) -> None:
        from uniffy.domains.agents.tools.builtin.skills import _execute_view_skill

        bundled = AgentSkill(
            id=uuid4(),
            organization_id=None,
            name="report",
            display_name="Report",
            source="bundled",
            content="BUNDLED_INSTRUCTIONS",
        )
        org = AgentSkill(
            id=uuid4(),
            organization_id=uuid4(),
            name="report",
            display_name="Report",
            source="organization",
            content="ORG_INSTRUCTIONS",
        )

        ctx = NS(
            session=MagicMock(),
            user_id=uuid4(),
            organization_id=uuid4(),
            agent_id=uuid4(),
            session_id=uuid4(),
        )

        import uniffy.domains.agents.cache as cache_mod
        import uniffy.domains.agents.skills.operations as ops_mod
        import uniffy.domains.agents.skills.usage as usage_mod

        monkeypatch.setattr(
            cache_mod, "fetch_agent_row", AsyncMock(return_value=NS(enabled_skills=[]))
        )

        async def _record(_session, **kw):
            return None

        monkeypatch.setattr(usage_mod, "record_skill_event", _record)

        # Assert determinism independent of the order the query returns rows.
        for ordered in ([bundled, org], [org, bundled]):
            fake_ops = MagicMock()
            fake_ops.get_skills_for_agent = AsyncMock(return_value=ordered)
            monkeypatch.setattr(
                ops_mod, "SkillOperations", lambda _session, _ops=fake_ops: _ops
            )

            result = _run(_execute_view_skill(ctx, {"name": "report"}))

            assert result.success
            assert "ORG_INSTRUCTIONS" in result.data
            assert "BUNDLED_INSTRUCTIONS" not in result.data
