from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from uniffy_proto.agents.v1.agents_pb2 import PreviewSystemPromptRequest

from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.agents.rule import AgentRule, RuleSource, RuleStatus
from uniffy.core.types import generate_id
from uniffy.domains.agents.agents import handlers
from uniffy.domains.agents.rules.converters import rule_to_proto
from uniffy.domains.agents.rules.operations import RuleOperations
from uniffy.domains.agents.rules.resolution import ResolvedRule, resolve_enabled_rules
from uniffy.domains.agents.rules.selection import RuleSelectionOperations
from uniffy.domains.agents.rules.validation import clean_rule_fields, validate_rule_selection
from uniffy.domains.agents.rules.versions import stage_rule_version
from uniffy.domains.agents.runtime.prompt import SkillPromptEntry, build_system_prompt


def _session(rows=()) -> MagicMock:
    session = MagicMock()
    result = MagicMock()
    result.all.return_value = rows
    result.scalars.return_value.all.return_value = rows
    session.execute = AsyncMock(return_value=result)
    session.flush = AsyncMock()
    session.commit = AsyncMock()
    return session


def _rule(**kwargs) -> AgentRule:
    return AgentRule(
        name="clear",
        display_name="Clear",
        description="Clarity",
        content="Be concrete.",
        source=RuleSource.ORGANIZATION,
        organization_id=generate_id(),
        **kwargs,
    )


async def _uncached(key, loader, **kwargs):
    return await loader()


class TestRuleVersions:
    async def test_follow_latest_preserves_immutable_snapshots(self) -> None:
        session = _session()
        rule = _rule(latest_version_number=0)
        first = await stage_rule_version(session, rule, author_id=None)
        rule.content = "Use examples."
        second = await stage_rule_version(session, rule, author_id=None)
        assert first.content == "Be concrete."
        assert second.content == "Use examples."
        assert second.version_number == 2
        assert rule.active_version_id == second.id
        assert second.parent_version_id == first.id
        session.commit.assert_not_awaited()

    async def test_pin_keeps_active_snapshot_during_edit(self) -> None:
        session = _session()
        rule = _rule(latest_version_number=0)
        first = await stage_rule_version(session, rule, author_id=None)
        rule.active_version_pinned = True
        rule.content = "Use examples."
        await stage_rule_version(session, rule, author_id=None)
        assert rule.active_version_id == first.id
        assert rule.latest_version_number == 2


class TestRuleSelection:
    @pytest.mark.parametrize("agent_id", [None, ""])
    async def test_selection_requires_an_agent(self, agent_id) -> None:
        session = _session()
        with (
            patch("uniffy.domains.agents.rules.selection.require_agents_builder", AsyncMock()),
            pytest.raises(ValidationError, match="agent"),
        ):
            await RuleSelectionOperations(session).set(generate_id(), generate_id(), agent_id, [])
        session.execute.assert_not_awaited()
        session.commit.assert_not_awaited()

    async def test_deduplicates_ids(self) -> None:
        rule = _rule()
        selected = await validate_rule_selection(
            _session([rule]), rule.organization_id, [str(rule.id), str(rule.id)], existing=[]
        )
        assert selected == [str(rule.id)]

    async def test_rejects_unavailable_rule(self) -> None:
        with pytest.raises(ValidationError, match="unavailable"):
            await validate_rule_selection(
                _session(), generate_id(), [str(generate_id())], existing=[]
            )

    async def test_retired_rule_can_stay_but_cannot_be_newly_enabled(self) -> None:
        rule = _rule(status=RuleStatus.RETIRED)
        ids = [str(rule.id)]
        with pytest.raises(ValidationError, match="Retired"):
            await validate_rule_selection(_session([rule]), rule.organization_id, ids, existing=[])
        assert (
            await validate_rule_selection(_session([rule]), rule.organization_id, ids, existing=ids)
            == ids
        )

    async def test_agent_view_denial_prevents_selection_write(self) -> None:
        session = _session()
        with (
            patch("uniffy.domains.agents.rules.selection.require_agents_builder", AsyncMock()),
            patch(
                "uniffy.domains.agents.rules.selection.AgentOperations.get_by_id",
                AsyncMock(side_effect=PermissionDeniedError("view agent")),
            ),
            pytest.raises(PermissionDeniedError),
        ):
            await RuleSelectionOperations(session).set(
                generate_id(), generate_id(), generate_id(), []
            )
        session.commit.assert_not_awaited()

    async def test_bundled_definition_is_read_only(self) -> None:
        rule = AgentRule(
            name="bundled", display_name="Bundled", content="Body", source=RuleSource.BUNDLED
        )
        session = _session()
        with (
            patch("uniffy.domains.agents.rules.operations.require_agents_builder", AsyncMock()),
            patch.object(RuleOperations, "_load", AsyncMock(return_value=rule)),
            pytest.raises(PermissionDeniedError),
        ):
            await RuleOperations(session).set_status(
                generate_id(), generate_id(), rule.id, RuleStatus.RETIRED
            )
        session.commit.assert_not_awaited()


class TestRuleResolution:
    async def test_cache_is_isolated_by_agent_and_selection(self) -> None:
        rule = _rule()
        version = SimpleNamespace(
            id=generate_id(), version_number=1, display_name="Selected", content="Body"
        )
        session = _session([(rule, version)])
        cached = AsyncMock(side_effect=_uncached)
        first_agent, second_agent = generate_id(), generate_id()
        with patch("uniffy.domains.agents.rules.resolution.cache_get_or_set_locked", cached):
            first = await resolve_enabled_rules(
                session,
                organization_id=rule.organization_id,
                agent_id=first_agent,
                enabled_rule_ids=[str(rule.id)],
            )
            assert (
                await resolve_enabled_rules(
                    session,
                    organization_id=rule.organization_id,
                    agent_id=second_agent,
                    enabled_rule_ids=[],
                )
                == ()
            )
            await resolve_enabled_rules(
                session,
                organization_id=rule.organization_id,
                agent_id=second_agent,
                enabled_rule_ids=[str(rule.id)],
            )
            other = _rule()
            session.execute.return_value.all.return_value = [(other, version)]
            await resolve_enabled_rules(
                session,
                organization_id=rule.organization_id,
                agent_id=first_agent,
                enabled_rule_ids=[str(other.id)],
            )
        assert first[0].id == rule.id
        keys = [call.args[0] for call in cached.await_args_list]
        assert len(set(keys)) == 3

    async def test_empty_selections_load_no_definitions(self) -> None:
        session = _session()
        with patch(
            "uniffy.domains.agents.rules.resolution.cache_get_or_set_locked", AsyncMock()
        ) as cache:
            assert (
                await resolve_enabled_rules(
                    session,
                    organization_id=generate_id(),
                    agent_id=generate_id(),
                    enabled_rule_ids=[],
                )
                == ()
            )
        session.execute.assert_not_awaited()
        cache.assert_not_awaited()

    async def test_selection_deduplicates_and_uses_exact_version(self) -> None:
        rule = _rule(latest_version_number=5)
        version = SimpleNamespace(
            id=generate_id(), version_number=2, display_name="Pinned", content="Pinned body"
        )
        with patch("uniffy.domains.agents.rules.resolution.cache_get_or_set_locked", _uncached):
            result = await resolve_enabled_rules(
                _session([(rule, version)]),
                organization_id=rule.organization_id,
                agent_id=generate_id(),
                enabled_rule_ids=[str(rule.id), str(rule.id)],
            )
        assert len(result) == 1
        assert result[0].version_number == 2
        assert result[0].content == "Pinned body"


def test_rules_append_in_stable_order_before_invoked_skill() -> None:
    rules = tuple(
        ResolvedRule(
            id=generate_id(),
            version_id=generate_id(),
            version_number=1,
            display_name=name,
            content=f"{name} body",
        )
        for name in ("First", "Second")
    )
    skill = SkillPromptEntry(
        id=generate_id(),
        name="task",
        display_name="Task",
        description="",
        when_to_use="",
        content="Invoked body",
        always_active=False,
    )
    prompt = build_system_prompt(
        agent_name="Agent", soul_prompt="Soul", org_name="Org", rules=rules, invoked_skill=skill
    )
    assert prompt.index("First body") < prompt.index("Second body") < prompt.index("Invoked body")
    assert prompt.endswith("Invoked body")
    assert "never grant workspace permissions" in prompt
    context = "These are rules attached to you that you must follow"
    assert prompt.count(context) == 1
    assert prompt.index(context) < prompt.index("First body")


def test_no_rules_omits_attached_rule_context() -> None:
    prompt = build_system_prompt(agent_name="Agent", soul_prompt="Soul", org_name="Org")
    assert "## Attached rules" not in prompt
    assert "These are rules attached to you" not in prompt
    assert "## Instruction priority" not in prompt


@pytest.mark.parametrize("content", ["Answer briefly.", "Keep {{input}} literal."])
def test_rule_context_is_fixed_outside_editable_body(content: str) -> None:
    rule = ResolvedRule(
        id=generate_id(),
        version_id=generate_id(),
        version_number=1,
        display_name="Custom guidance",
        content=content,
    )
    prompt = build_system_prompt(
        agent_name="Agent", soul_prompt="Soul", org_name="Org", rules=(rule,)
    )
    assert prompt.endswith(f"### Agent rule: Custom guidance\n\n{content}")
    assert "These rules were selected specifically for you" in prompt
    assert "organization rules" not in prompt
    assert "cannot override Uniffy product instructions" in prompt


def test_rule_text_is_sanitized_without_interpolation() -> None:
    fields = clean_rule_fields(
        name="clear", display_name="Clear", description="", content="Keep {{input}} literal.\u200b"
    )
    assert fields["content"] == "Keep {{input}} literal."


def test_rule_picker_summary_omits_instructions() -> None:
    rule = _rule()
    assert rule_to_proto(rule, include_content=False).content == ""
    assert rule_to_proto(rule).content == rule.content


async def test_prompt_preview_resolves_the_agents_enabled_rules() -> None:
    session = _session()
    organization_id, user_id = generate_id(), generate_id()
    rule = ResolvedRule(
        id=generate_id(),
        version_id=generate_id(),
        version_number=2,
        display_name="Clarity",
        content="Preview rule body",
    )
    agent = SimpleNamespace(
        id=generate_id(),
        name="Agent",
        soul_prompt="Soul",
        enabled_tools=[],
        enabled_skills=[],
        enabled_rules=[str(rule.id)],
    )
    context = MagicMock()
    context.__aenter__ = AsyncMock(return_value=session)
    context.__aexit__ = AsyncMock(return_value=False)
    handler = handlers.AgentsHandlers()
    handler.search_indexer = MagicMock()
    with (
        patch.object(handlers, "current_user_id", return_value=user_id),
        patch.object(handlers, "open_session", return_value=context),
        patch.object(handlers.AgentOperations, "get_by_id", AsyncMock(return_value=agent)),
        patch.object(
            handlers.OrganizationOperations,
            "get_by_id",
            AsyncMock(return_value=SimpleNamespace(name="Org")),
        ),
        patch.object(
            handlers.OrganizationOperations,
            "require_org_member",
            AsyncMock(return_value=SimpleNamespace(role="member")),
        ),
        patch.object(
            handlers.UserOperations,
            "get_by_id",
            AsyncMock(return_value=SimpleNamespace(full_name="Member", username="member")),
        ),
        patch.object(handlers.SkillOperations, "get_skills_for_agent", AsyncMock(return_value=[])),
        patch.object(handler, "_fetch_memory_context_for_preview", AsyncMock(return_value=None)),
        patch.object(handlers, "filter_integration_tool_schemas", AsyncMock(return_value=[])),
        patch.object(
            handlers, "resolve_enabled_rules", autospec=True, return_value=(rule,)
        ) as resolve,
    ):
        result = await handler.preview_system_prompt(
            PreviewSystemPromptRequest(organization_id=str(organization_id), agent_id=str(agent.id)),
            MagicMock(),
        )
    resolve.assert_awaited_once_with(
        session,
        organization_id=organization_id,
        agent_id=agent.id,
        enabled_rule_ids=agent.enabled_rules,
    )
    assert result.system_prompt.endswith("Preview rule body")
