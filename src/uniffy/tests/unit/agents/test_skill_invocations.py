from dataclasses import FrozenInstanceError
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.models.agents.skill_version import AgentSkillVersion
from uniffy.core.types import generate_id
from uniffy.domains.agents.runtime import skills as runtime_skills
from uniffy.domains.agents.runtime import send, stream
from uniffy.domains.agents.runtime.destinations import ChatDestination, SessionDestination
from uniffy.domains.agents.runtime.prompt import build_system_prompt
from uniffy.domains.agents.skills import resolution
from uniffy.domains.agents import cache as agent_cache
from uniffy.domains.agents.skills.resolution import (
    SkillInvocationError,
    SkillInvocationFailure,
    SkillSurface,
    resolve_skill_invocation,
)
from uniffy.domains.agents.bridge.operations import _parse_invoked_skill_id
from uniffy.domains.agents.skills.validation import validate_supported_surfaces


@pytest.fixture
def snapshot(monkeypatch):
    version = AgentSkillVersion(
        skill_id=generate_id(),
        version_number=2,
        name="report",
        display_name="Report",
        description="Prepare a report",
        content="Exact pinned body {{input}}",
    )
    session = MagicMock()
    result = MagicMock()
    result.one_or_none.return_value = version
    session.execute = AsyncMock(return_value=result)

    async def uncached(key, loader, **kwargs):
        return await loader()

    cache = AsyncMock(side_effect=uncached)
    monkeypatch.setattr(resolution, "cache_get_or_set_locked", cache)
    return version, session, cache


def invocation_args(version, **overrides):
    return {
        "organization_id": generate_id(),
        "enabled_skill_ids": [str(version.skill_id)],
        "invoked_skill_id": version.skill_id,
        "surface": SkillSurface.SESSION,
        "executable_tools": frozenset(),
        **overrides,
    }


@pytest.mark.parametrize("raw", ["", "invalid", None, [], 42])
def test_malformed_chat_invocation_is_not_an_ordinary_turn(raw):
    with pytest.raises(SkillInvocationError):
        _parse_invoked_skill_id({"invoked_skill_id": raw})


def test_absent_chat_invocation_is_an_ordinary_turn():
    assert _parse_invoked_skill_id(None) is None
    assert _parse_invoked_skill_id({}) is None
    skill_id = generate_id()
    assert _parse_invoked_skill_id({"invoked_skill_id": str(skill_id)}) == skill_id


def test_supported_surfaces_are_closed_and_deduplicated():
    assert validate_supported_surfaces(["chat", "chat", "session"]) == ["chat", "session"]
    assert validate_supported_surfaces(None) == []
    with pytest.raises(resolution.ValidationError, match="session or chat"):
        validate_supported_surfaces(["unknown"])


async def test_menu_batches_exact_summaries_without_loading_bodies(snapshot):
    version, session, _ = snapshot
    session.execute.return_value.all.return_value = [version]
    results = await resolution.resolve_runnable_skills(
        session,
        organization_id=generate_id(),
        enabled_skill_ids=[str(version.skill_id), str(version.skill_id)],
        surface=SkillSurface.CHAT,
        executable_tools=frozenset(),
    )
    assert [item.version_id for item in results] == [version.id]
    assert not hasattr(results[0], "content")
    session.execute.assert_awaited_once()
    assert "content" not in session.execute.call_args.args[0].selected_columns.keys()


async def test_menu_rechecks_current_requirements_on_cached_summaries(snapshot):
    version, session, cache = snapshot
    version.requires_tools = ["search.query"]
    version.supported_surfaces = ["chat"]
    session.execute.return_value.all.return_value = [version]
    args = dict(
        organization_id=generate_id(),
        enabled_skill_ids=[str(version.skill_id)],
        surface=SkillSurface.CHAT,
        executable_tools=frozenset({"search.query"}),
    )
    assert len(await resolution.resolve_runnable_skills(session, **args)) == 1
    payload = await cache.call_args.args[1]()
    cache.side_effect = None
    cache.return_value = payload
    session.execute.reset_mock()
    assert await resolution.resolve_runnable_skills(
        session, **{**args, "executable_tools": frozenset()}
    ) == []
    assert await resolution.resolve_runnable_skills(
        session, **{**args, "surface": SkillSurface.SESSION}
    ) == []
    cache.reset_mock()
    assert await resolution.resolve_runnable_skills(
        session, **{**args, "enabled_skill_ids": []}
    ) == []
    cache.assert_not_awaited()
    session.execute.assert_not_awaited()


async def test_ordinary_turn_skips_skill_cache_and_database(snapshot):
    version, session, cache = snapshot
    result = await resolve_skill_invocation(
        session, **invocation_args(version, invoked_skill_id=None)
    )
    assert result is None
    cache.assert_not_awaited()
    session.execute.assert_not_awaited()


async def test_unassigned_skill_fails_before_any_lookup(snapshot):
    version, session, cache = snapshot
    with pytest.raises(SkillInvocationError) as error:
        await resolve_skill_invocation(session, **invocation_args(version, enabled_skill_ids=[]))
    assert error.value.reason == SkillInvocationFailure.UNAVAILABLE
    cache.assert_not_awaited()
    session.execute.assert_not_awaited()


async def test_missing_exact_snapshot_never_falls_back_to_head(snapshot):
    version, session, _ = snapshot
    session.execute.return_value.one_or_none.return_value = None
    with pytest.raises(SkillInvocationError) as error:
        await resolve_skill_invocation(session, **invocation_args(version))
    assert error.value.reason == SkillInvocationFailure.UNAVAILABLE
    session.execute.assert_awaited_once()


async def test_snapshot_is_immutable_and_renders_literal_content_once(snapshot):
    version, session, _ = snapshot
    skill = await resolve_skill_invocation(session, **invocation_args(version))
    assert skill.version_id == version.id
    assert skill.version_number == 2
    assert skill.content == version.content
    with pytest.raises(FrozenInstanceError):
        skill.content = "Changed"
    prompt = build_system_prompt(
        agent_name="Agent", soul_prompt="Soul", org_name="Org", invoked_skill=skill
    )
    assert prompt.count(version.content) == 1
    assert prompt.endswith(version.content)
    assert "cannot override Uniffy product instructions" in prompt
    assert "{{input}}" in prompt
    assert "skills.view_skill" not in prompt


@pytest.mark.parametrize("surface", list(SkillSurface))
async def test_requirements_use_executable_tools_not_raw_assignment(snapshot, surface):
    version, session, _ = snapshot
    version.requires_tools = ["github.get_issue"]
    with pytest.raises(SkillInvocationError) as error:
        await resolve_skill_invocation(session, **invocation_args(version, surface=surface))
    assert error.value.reason == SkillInvocationFailure.MISSING_TOOLS
    assert await resolve_skill_invocation(
        session,
        **invocation_args(
            version, surface=surface, executable_tools=frozenset({"github.get_issue"})
        ),
    )


@pytest.mark.parametrize("required", [["chat"], ["unknown"]])
async def test_unsupported_surface_fails_visibly(snapshot, required):
    version, session, _ = snapshot
    version.supported_surfaces = required
    with pytest.raises(SkillInvocationError) as error:
        await resolve_skill_invocation(session, **invocation_args(version))
    assert error.value.reason == SkillInvocationFailure.UNSUPPORTED_SURFACE


async def test_cache_cannot_bypass_current_assignment_or_tools(snapshot):
    version, session, cache = snapshot
    version.requires_tools = ["search.query"]
    args = invocation_args(version, executable_tools=frozenset({"search.query"}))
    await resolve_skill_invocation(session, **args)
    payload = await cache.call_args.args[1]()
    cache.side_effect = None
    cache.return_value = payload
    session.execute.reset_mock()
    with pytest.raises(SkillInvocationError) as error:
        await resolve_skill_invocation(session, **{**args, "executable_tools": frozenset()})
    assert error.value.reason == SkillInvocationFailure.MISSING_TOOLS
    cache.reset_mock()
    with pytest.raises(SkillInvocationError) as error:
        await resolve_skill_invocation(session, **{**args, "enabled_skill_ids": []})
    assert error.value.reason == SkillInvocationFailure.UNAVAILABLE
    cache.assert_not_awaited()
    session.execute.assert_not_awaited()


async def test_cache_keys_isolate_tenants(snapshot):
    version, session, cache = snapshot
    await resolve_skill_invocation(session, **invocation_args(version))
    await resolve_skill_invocation(session, **invocation_args(version))
    assert cache.await_args_list[0].args[0] != cache.await_args_list[1].args[0]


async def test_skill_mutation_invalidates_exact_snapshot_without_agent_refs(monkeypatch):
    skill_id = generate_id()
    invalidate = AsyncMock()
    monkeypatch.setattr(agent_cache, "cache_invalidate_by_tag", invalidate)
    monkeypatch.setattr(agent_cache, "_set_members", AsyncMock(return_value=[]))
    await agent_cache.invalidate_agents_using_skill(skill_id)
    invalidate.assert_awaited_once_with(f"skill_snapshot:{skill_id}")


async def test_usage_records_the_resolved_version_not_latest(snapshot, monkeypatch):
    version, session, _ = snapshot
    record = AsyncMock()
    monkeypatch.setattr(runtime_skills, "record_skill_event", record)
    skill = await runtime_skills.resolve_invoked_skill(
        session,
        **invocation_args(version),
        agent_id=generate_id(),
        user_id=generate_id(),
        session_id=None,
    )
    assert skill.version_id == version.id
    assert record.await_args.kwargs["skill_version"] == version.version_number
    assert record.await_args.kwargs["invoked"] is True


@pytest.mark.parametrize("invoked", [False, True])
async def test_absent_or_invalid_invocation_records_no_usage(snapshot, monkeypatch, invoked):
    version, session, _ = snapshot
    record = AsyncMock()
    monkeypatch.setattr(runtime_skills, "record_skill_event", record)
    args = {
        **invocation_args(version, invoked_skill_id=version.skill_id if invoked else None),
        "enabled_skill_ids": [],
        "agent_id": generate_id(),
        "user_id": generate_id(),
        "session_id": None,
    }
    if invoked:
        with pytest.raises(SkillInvocationError):
            await runtime_skills.resolve_invoked_skill(session, **args)
    else:
        assert await runtime_skills.resolve_invoked_skill(session, **args) is None
    record.assert_not_awaited()


class PreflightComplete(Exception):
    pass


@pytest.mark.parametrize("destination_kind", ["unary", "session", "chat"])
@pytest.mark.parametrize("invoked", [False, True])
async def test_runtime_uses_final_tools_and_skips_ordinary_skill_reads(
    snapshot, monkeypatch, destination_kind, invoked
):
    version, session, cache = snapshot
    version.requires_tools = ["github.get_issue"]
    module = send if destination_kind == "unary" else stream
    runtime_type = send.MessageSender if destination_kind == "unary" else stream.MessageStreamer
    runtime = runtime_type.__new__(runtime_type)
    agent = SimpleNamespace(
        id=generate_id(), enabled_tools=["github.get_issue"], enabled_skills=[str(version.skill_id)]
    )
    session_row = SimpleNamespace(
        id=generate_id(),
        agent_id=agent.id,
        model_override=None,
        loaded_tool_groups=[],
        kind="direct",
    )
    runtime._session = session
    runtime._org_operations = SimpleNamespace(
        require_org_member=AsyncMock(return_value=SimpleNamespace(role="member")),
        get_by_id=AsyncMock(return_value=SimpleNamespace(name="Org")),
    )
    runtime._user_operations = SimpleNamespace(get_by_id=AsyncMock(return_value=SimpleNamespace()))
    runtime._agent_operations = SimpleNamespace(get_for_runtime=AsyncMock(return_value=agent))
    runtime._session_operations = SimpleNamespace(get_session=AsyncMock(return_value=session_row))
    runtime._provider_operations = MagicMock()
    runtime._memory = SimpleNamespace(resolve_scope=AsyncMock(side_effect=PreflightComplete))
    monkeypatch.setattr(
        module,
        "resolve_provider_and_model",
        AsyncMock(return_value=(MagicMock(), generate_id(), "m")),
    )
    monkeypatch.setattr(module, "resolve_image_config", AsyncMock(return_value=None))
    monkeypatch.setattr(module, "apply_image_tool_schema", lambda schemas, config: schemas)
    filtered = AsyncMock(return_value=[])
    monkeypatch.setattr(module, "filter_integration_tool_schemas", filtered)
    monkeypatch.setattr(
        module,
        "plan_tool_advertisement",
        lambda *args: SimpleNamespace(tool_schemas=[], deferred={}),
    )
    usage = AsyncMock()
    monkeypatch.setattr(runtime_skills, "record_skill_event", usage)
    args = dict(
        user_id=generate_id(),
        organization_id=generate_id(),
        content="User text",
        invoked_skill_id=version.skill_id if invoked else None,
    )
    if destination_kind == "chat":
        binding = MagicMock()
        binding.one_or_none.return_value = None
        snapshot_result = session.execute.return_value
        session.execute.side_effect = [binding, snapshot_result]
        destination = ChatDestination(
            channel_id=generate_id(), agent_id=agent.id, trigger_message_id=generate_id()
        )
    else:
        destination = SessionDestination(session_id=session_row.id)

    async def run():
        if destination_kind == "unary":
            await runtime.send(**args, session_id=session_row.id)
        else:
            async for _ in runtime.stream(**args, destination=destination):
                pass

    if invoked:
        with pytest.raises(SkillInvocationError) as error:
            await run()
        assert error.value.reason == SkillInvocationFailure.MISSING_TOOLS
        cache.assert_awaited_once()
        runtime._memory.resolve_scope.assert_not_awaited()
    else:
        with pytest.raises(PreflightComplete):
            await run()
        cache.assert_not_awaited()
    filtered.assert_awaited_once()
    usage.assert_not_awaited()
