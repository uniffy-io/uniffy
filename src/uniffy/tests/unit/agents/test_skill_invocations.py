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
from uniffy.domains.agents.invocation import parse_invoked_skill_id
from uniffy.domains.agents import invocation
from uniffy.core.models.chat.message import SenderType
from uniffy.core.errors import PermissionDeniedError
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
        parse_invoked_skill_id({"invoked_skill_id": raw})


def test_absent_chat_invocation_is_an_ordinary_turn():
    assert parse_invoked_skill_id(None) is None
    assert parse_invoked_skill_id({}) is None
    skill_id = generate_id()
    assert parse_invoked_skill_id({"invoked_skill_id": str(skill_id)}) == skill_id


@pytest.fixture
def chat_preflight(monkeypatch):
    session = MagicMock()
    session.execute = AsyncMock(return_value=MagicMock())
    session.execute.return_value.one_or_none.return_value = SimpleNamespace(
        owner_id=generate_id(), access_mode=None, baseline_role=None
    )
    message = SimpleNamespace(
        sender_type=SenderType.USER,
        sender_id=generate_id(),
        message_metadata={"invoked_skill_id": str(generate_id())},
    )
    channel = SimpleNamespace(organization_id=generate_id())
    agent = SimpleNamespace(
        enabled_skills=[message.message_metadata["invoked_skill_id"]], enabled_tools=[]
    )
    patches = {
        "detect_agent_mentions": AsyncMock(return_value=[SimpleNamespace(agent_id=generate_id())]),
        "require_view": AsyncMock(),
        "fetch_agent_row": AsyncMock(return_value=agent),
        "resolve_tool_schemas": MagicMock(return_value=[{"name": "search-query"}]),
        "resolve_image_config": AsyncMock(return_value=None),
        "apply_image_tool_schema": MagicMock(
            return_value=[{"name": "search-query"}, {"name": "github-read"}]
        ),
        "filter_integration_tool_schemas": AsyncMock(return_value=[{"name": "search-query"}]),
        "resolve_skill_invocation": AsyncMock(),
    }
    for name, mock in patches.items():
        monkeypatch.setattr(invocation, name, mock)
    return session, message, channel, patches


async def test_chat_preflight_ordinary_turn_has_no_reads(chat_preflight):
    session, message, channel, mocks = chat_preflight
    message.message_metadata = None
    await invocation.validate_chat_skill_invocation(session, message, channel)
    session.execute.assert_not_awaited()
    for mock in mocks.values():
        mock.assert_not_called()


@pytest.mark.parametrize("target_count", [0, 2])
async def test_chat_preflight_rejects_missing_or_ambiguous_agent(chat_preflight, target_count):
    session, message, channel, mocks = chat_preflight
    mocks["detect_agent_mentions"].return_value *= target_count
    with pytest.raises(SkillInvocationError):
        await invocation.validate_chat_skill_invocation(session, message, channel)
    session.execute.assert_not_awaited()
    mocks["resolve_skill_invocation"].assert_not_awaited()


async def test_chat_preflight_rechecks_access_before_reading_skill(chat_preflight):
    session, message, channel, mocks = chat_preflight
    mocks["require_view"].side_effect = PermissionDeniedError("access")
    with pytest.raises(PermissionDeniedError):
        await invocation.validate_chat_skill_invocation(session, message, channel)
    mocks["fetch_agent_row"].assert_not_awaited()
    mocks["resolve_skill_invocation"].assert_not_awaited()


async def test_chat_preflight_uses_final_executable_tools(chat_preflight):
    session, message, channel, mocks = chat_preflight
    await invocation.validate_chat_skill_invocation(session, message, channel)
    kwargs = mocks["resolve_skill_invocation"].call_args.kwargs
    assert kwargs["executable_tools"] == frozenset({"search.query"})
    assert kwargs["surface"] == SkillSurface.CHAT
    assert kwargs["organization_id"] == channel.organization_id
    assert str(kwargs["invoked_skill_id"]) == message.message_metadata["invoked_skill_id"]
    session.add.assert_not_called()


async def test_chat_rejected_invocation_is_not_persisted(monkeypatch):
    from uniffy.domains.chat.messages import sending

    sender = sending.MessageSender()
    sender.session = MagicMock()
    sender.session.flush = AsyncMock()
    sender.session.commit = AsyncMock()
    channel = SimpleNamespace(is_agent_dm=False)
    sender.access = SimpleNamespace(
        get_channel=AsyncMock(return_value=channel), require_send=AsyncMock()
    )
    monkeypatch.setattr(sending, "check_chat_mutation_limit", AsyncMock())
    monkeypatch.setattr(
        sending,
        "validate_chat_skill_invocation",
        AsyncMock(side_effect=SkillInvocationError(SkillInvocationFailure.UNAVAILABLE)),
    )
    with pytest.raises(SkillInvocationError):
        await sender.send_message(
            generate_id(),
            generate_id(),
            generate_id(),
            "Keep my draft",
            message_metadata={"invoked_skill_id": str(generate_id())},
        )
    sender.session.add.assert_not_called()
    sender.session.flush.assert_not_awaited()
    sender.session.commit.assert_not_awaited()


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
    assert (
        await resolution.resolve_runnable_skills(
            session, **{**args, "executable_tools": frozenset()}
        )
        == []
    )
    assert (
        await resolution.resolve_runnable_skills(
            session, **{**args, "surface": SkillSurface.SESSION}
        )
        == []
    )
    cache.reset_mock()
    assert (
        await resolution.resolve_runnable_skills(session, **{**args, "enabled_skill_ids": []}) == []
    )
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


async def test_invocation_records_the_resolved_version_not_latest(snapshot, monkeypatch):
    version, session, _ = snapshot
    record = AsyncMock()
    invocation = SimpleNamespace(start=record)
    skill = await runtime_skills.resolve_invoked_skill(
        session,
        **invocation_args(version),
        agent_id=generate_id(),
        user_id=generate_id(),
        session_id=generate_id(),
        invocation=invocation,
    )
    assert skill.version_id == version.id
    assert record.await_args.args[0].skill_version_number == version.version_number
    assert record.await_args.args[0].skill_version_id == version.id


@pytest.mark.parametrize("invoked", [False, True])
async def test_absent_or_invalid_invocation_records_no_usage(snapshot, monkeypatch, invoked):
    version, session, _ = snapshot
    record = AsyncMock()
    invocation = SimpleNamespace(start=record)
    args = {
        **invocation_args(version, invoked_skill_id=version.skill_id if invoked else None),
        "enabled_skill_ids": [],
        "agent_id": generate_id(),
        "user_id": generate_id(),
        "session_id": generate_id(),
        "invocation": invocation,
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
    runtime._session_factory = MagicMock()
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
    recorder = SimpleNamespace(
        start=AsyncMock(return_value=SimpleNamespace(status="started")),
        finalize=AsyncMock(),
    )
    monkeypatch.setattr(runtime_skills, "SkillInvocationRecorder", lambda _: recorder)
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
    if invoked:
        recorder.start.assert_awaited_once()
        assert recorder.finalize.await_args.kwargs["status"] == "rejected"
        assert recorder.finalize.await_args.kwargs["error_code"] == "missing_tools"
    else:
        recorder.start.assert_not_awaited()
        recorder.finalize.assert_not_awaited()
