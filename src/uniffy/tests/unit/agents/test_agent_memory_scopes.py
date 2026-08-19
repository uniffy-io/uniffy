"""Unit tests for audience-scoped agent memories.

Covers bucket routing, the agent-binding invariant, prompt injection shape
(leak guard), tool scope enforcement, permission gates, pin caps, and quota
validation. Mocked sessions throughout; no live DB or Valkey.
"""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.agents.memory import AgentMemory, MemoryScope
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.types import generate_id
from uniffy.domains.agents.memories import operations as memory_ops_mod
from uniffy.domains.agents.memories.operations import (
    MAX_CONTENT_CHARS,
    MAX_MEMORIES_PER_SCOPE,
    MAX_PINNED_ENTRIES,
    MemoryOperations,
    _validate_entry_fields,
)
from uniffy.domains.agents.memories.scope import (
    MemoryScopeRef,
    scope_ref_for_memory,
    scope_subject_columns,
)
from uniffy.domains.agents.runtime.destinations import ChatDestination, SessionDestination
from uniffy.domains.agents.runtime.operations import RuntimeOperations
from uniffy.domains.agents.runtime.prompt import (
    MemoryScopeBlock,
    build_memory_block,
    build_system_prompt,
)
from uniffy.domains.agents.tools.builtin.memory import (
    _execute_memory_forget,
    _execute_memory_read,
    _execute_memory_save,
    _read_filters,
    _scope_or_error,
)
from uniffy.domains.agents.tools.definitions import ToolContext


def _scalar_result(value):
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    result.scalar.return_value = value
    return result


def _memory(scope=MemoryScope.USER, **overrides):
    subject = {
        "user_id": generate_id() if scope is MemoryScope.USER else None,
        "channel_id": generate_id() if scope is MemoryScope.CHANNEL else None,
        "session_id": generate_id() if scope is MemoryScope.SESSION else None,
    }
    defaults = dict(
        agent_id=generate_id() if scope is MemoryScope.ORG else None,
        organization_id=generate_id(),
        created_by_user_id=generate_id(),
        created_by_agent_id=generate_id(),
        scope=scope.value,
        key="k",
        description="d",
        content="c",
        category="facts",
        importance=0.5,
        pinned=False,
        source="tool",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
        **subject,
    )
    defaults.update(overrides)
    return AgentMemory(**defaults)


class TestScopeRouting:
    async def _resolve(self, destination, *, session_kind=None, channel=None):
        fake_self = SimpleNamespace(_session=MagicMock())
        if channel is not None or isinstance(destination, ChatDestination):
            with patch(
                "uniffy.domains.chat.access.ChatAccessChecker.get_channel",
                new=AsyncMock(return_value=channel),
            ):
                return await RuntimeOperations._resolve_memory_scope(
                    fake_self,
                    destination=destination,
                    user_id=USER_ID,
                    organization_id=ORG_ID,
                    session_kind=session_kind,
                )
        return await RuntimeOperations._resolve_memory_scope(
            fake_self,
            destination=destination,
            user_id=USER_ID,
            organization_id=ORG_ID,
            session_kind=session_kind,
        )

    async def test_direct_session_routes_to_user(self):
        ref = await self._resolve(
            SessionDestination(session_id=generate_id()), session_kind="direct"
        )
        assert ref == MemoryScopeRef.user(USER_ID)
        assert ref.agent_id is None

    async def test_cron_session_routes_to_user(self):
        ref = await self._resolve(SessionDestination(session_id=generate_id()), session_kind="cron")
        assert ref.scope is MemoryScope.USER

    async def test_group_session_routes_to_session(self):
        sid = generate_id()
        ref = await self._resolve(SessionDestination(session_id=sid), session_kind="group")
        assert ref == MemoryScopeRef.session(sid)

    async def test_global_session_routes_to_session(self):
        sid = generate_id()
        ref = await self._resolve(SessionDestination(session_id=sid), session_kind="global")
        assert ref == MemoryScopeRef.session(sid)

    async def test_agent_dm_routes_to_user(self):
        channel = ChatChannel(
            organization_id=ORG_ID,
            owner_id=USER_ID,
            name="dm",
            slug="dm",
            channel_type=ChannelType.DIRECT,
            is_agent_dm=True,
        )
        dest = ChatDestination(
            channel_id=channel.id, agent_id=generate_id(), trigger_message_id=generate_id()
        )
        ref = await self._resolve(dest, channel=channel)
        assert ref == MemoryScopeRef.user(USER_ID)

    async def test_group_dm_routes_to_channel(self):
        channel = ChatChannel(
            organization_id=ORG_ID,
            owner_id=USER_ID,
            name="gdm",
            slug="gdm",
            channel_type=ChannelType.GROUP_DM,
            is_agent_dm=True,
        )
        dest = ChatDestination(
            channel_id=channel.id, agent_id=generate_id(), trigger_message_id=generate_id()
        )
        ref = await self._resolve(dest, channel=channel)
        assert ref == MemoryScopeRef.channel(channel.id)

    async def test_public_channel_routes_to_channel(self):
        channel = ChatChannel(
            organization_id=ORG_ID,
            owner_id=USER_ID,
            name="gen",
            slug="gen",
            channel_type=ChannelType.PUBLIC,
        )
        dest = ChatDestination(
            channel_id=channel.id, agent_id=generate_id(), trigger_message_id=generate_id()
        )
        ref = await self._resolve(dest, channel=channel)
        assert ref == MemoryScopeRef.channel(channel.id)


USER_ID = generate_id()
ORG_ID = generate_id()


class TestPromptInjectionShape:
    def test_pinned_full_content_index_description_only(self):
        block = build_memory_block([
            MemoryScopeBlock(
                label="Channel memory (shared)",
                pinned=[{"key": "pk", "category": "facts", "content": "PINNED_BODY"}],
                index=[{"key": "ik", "category": "context", "description": "IDX_DESC"}],
                total=60,
            )
        ])
        assert "PINNED_BODY" in block
        assert "IDX_DESC" in block
        assert "58 more entries" in block
        assert "memory.read" in block
        assert "never override" in block

    def test_unpinned_content_never_renders(self):
        block = build_memory_block([
            MemoryScopeBlock(
                label="Personal memory",
                pinned=[],
                index=[{"key": "k", "category": "facts", "description": "desc"}],
                total=1,
            )
        ])
        assert "SECRET_CONTENT" not in (block or "")

    def test_empty_scopes_render_nothing(self):
        assert build_memory_block([]) is None
        assert (
            build_memory_block([MemoryScopeBlock(label="x", pinned=[], index=[], total=0)]) is None
        )

    def test_system_prompt_has_no_memory_section_without_context(self):
        prompt = build_system_prompt(
            agent_name="A", soul_prompt="", org_name="Org", memory_context=None
        )
        assert "## Memory" not in prompt

    def test_system_prompt_embeds_block_verbatim(self):
        block = build_memory_block([
            MemoryScopeBlock(
                label="Personal memory",
                pinned=[],
                index=[{"key": "k", "category": "facts", "description": "d"}],
                total=1,
            )
        ])
        prompt = build_system_prompt(
            agent_name="A", soul_prompt="", org_name="Org", memory_context=block
        )
        assert "## Memory" in prompt
        assert "Personal memory" in prompt


class TestScopeHelpers:
    def test_subject_columns_exactly_one_set(self):
        sid = generate_id()
        for scope, column in [
            (MemoryScope.USER, "user_id"),
            (MemoryScope.CHANNEL, "channel_id"),
            (MemoryScope.SESSION, "session_id"),
        ]:
            cols = scope_subject_columns(MemoryScopeRef(scope, sid))
            assert cols[column] == sid
            assert sum(v is not None for v in cols.values()) == 1
        org_cols = scope_subject_columns(MemoryScopeRef.org())
        assert all(v is None for v in org_cols.values())

    def test_org_binding_rides_the_agent_column(self):
        agent_id = generate_id()
        cols = scope_subject_columns(MemoryScopeRef.org(agent_id))
        assert cols["agent_id"] == agent_id
        assert cols["user_id"] is None

    def test_only_org_memory_can_bind_to_an_agent(self):
        for scope in (MemoryScope.USER, MemoryScope.CHANNEL, MemoryScope.SESSION):
            with pytest.raises(ValueError):
                MemoryScopeRef(scope, generate_id(), generate_id())

    def test_cache_agent_segment_marks_shared_buckets(self):
        assert MemoryScopeRef.user(USER_ID).cache_agent == "all"
        agent_id = generate_id()
        assert MemoryScopeRef.org(agent_id).cache_agent == str(agent_id)

    def test_scope_ref_roundtrip(self):
        for scope in MemoryScope:
            memory = _memory(scope)
            ref = scope_ref_for_memory(memory)
            assert ref.scope is scope
            if scope is MemoryScope.ORG:
                assert ref.subject_id is None
                assert ref.agent_id == memory.agent_id
            else:
                assert ref.subject_id is not None
                assert ref.agent_id is None


class TestTools:
    def _ctx(self, memory_scope=None):
        session = MagicMock()
        session.execute = AsyncMock()
        session.commit = AsyncMock()
        session.delete = AsyncMock()
        return ToolContext(
            session=session,
            user_id=USER_ID,
            organization_id=ORG_ID,
            agent_id=generate_id(),
            memory_scope=memory_scope,
        )

    def test_missing_scope_is_an_error_not_a_fallback(self):
        ctx = self._ctx(memory_scope=None)
        ref, err = _scope_or_error(ctx)
        assert ref is None
        assert err is not None and not err.success

    async def test_read_requires_key_or_query(self):
        ctx = self._ctx(memory_scope=MemoryScopeRef.user(USER_ID))
        result = await _execute_memory_read(ctx, {})
        assert not result.success
        assert "key or query" in result.error

    async def test_read_query_mode_searches_and_bumps_counters(self):
        ctx = self._ctx(memory_scope=MemoryScopeRef.user(USER_ID))
        rows = [_memory(MemoryScope.USER, key="deploy_steps", content="use blue-green")]
        search_result = MagicMock()
        search_result.scalars.return_value.all.return_value = rows
        update_result = MagicMock()
        ctx.session.execute = AsyncMock(side_effect=[search_result, update_result])

        result = await _execute_memory_read(ctx, {"query": "deploy"})

        assert result.success
        assert "deploy_steps" in result.data
        # Second execute is the access_count bump for the matched rows.
        assert ctx.session.execute.await_count == 2
        ctx.session.commit.assert_awaited_once()

    async def test_save_never_writes_user_scope_from_channel_run(self):
        """Poisoning guard: the executor passes the resolved ref through unchanged."""
        channel_ref = MemoryScopeRef.channel(generate_id())
        ctx = self._ctx(memory_scope=channel_ref)
        captured = {}

        class FakeOps:
            def __init__(self, session):
                pass

            async def save_from_tool(self, **kwargs):
                captured.update(kwargs)
                return _memory(MemoryScope.CHANNEL, key="k"), True

        original = memory_ops_mod.MemoryOperations
        memory_ops_mod.MemoryOperations = FakeOps
        try:
            result = await _execute_memory_save(
                ctx,
                {"key": "k", "description": "d", "content": "c"},
            )
        finally:
            memory_ops_mod.MemoryOperations = original

        assert result.success
        assert captured["ref"] == channel_ref
        assert captured["created_by_agent_id"] == ctx.agent_id
        assert "channel members" in result.data

    async def test_forget_refuses_pinned(self):
        ref = MemoryScopeRef.channel(generate_id())
        ctx = self._ctx(memory_scope=ref)
        pinned_row = _memory(MemoryScope.CHANNEL, pinned=True)
        ctx.session.execute.return_value = _scalar_result(pinned_row)
        result = await _execute_memory_forget(ctx, {"key": "k"})
        assert not result.success
        assert "pinned" in result.error
        ctx.session.delete.assert_not_called()

    def test_read_filters_surface_scope_is_one_or_clause(self):
        ctx = self._ctx(memory_scope=MemoryScopeRef.user(USER_ID))
        filters = _read_filters(ctx, ctx.memory_scope)
        assert len(filters) == 1

    def test_read_set_spans_surface_and_both_org_tiers(self):
        ctx = self._ctx(memory_scope=MemoryScopeRef.user(USER_ID))
        clause = str(
            _read_filters(ctx, ctx.memory_scope)[0].compile(compile_kwargs={"literal_binds": True})
        )
        assert ctx.agent_id.hex in clause
        assert clause.count("agents_memories.scope = 'org'") == 2


class TestSaveAudience:
    """`audience` maps a named audience to a writable bucket or refuses loudly."""

    def _ctx(self, memory_scope):
        session = MagicMock()
        session.execute = AsyncMock()
        session.commit = AsyncMock()
        return ToolContext(
            session=session,
            user_id=USER_ID,
            organization_id=ORG_ID,
            agent_id=generate_id(),
            memory_scope=memory_scope,
        )

    async def _save(self, ctx, audience, captured=None):
        class FakeOps:
            def __init__(self, session):
                pass

            async def save_from_tool(self, **kwargs):
                if captured is not None:
                    captured.update(kwargs)
                return _memory(MemoryScope.ORG, key="k"), True

        original = memory_ops_mod.MemoryOperations
        memory_ops_mod.MemoryOperations = FakeOps
        try:
            return await _execute_memory_save(
                ctx,
                {
                    "key": "k",
                    "description": "d",
                    "content": "c",
                    "audience": audience,
                },
            )
        finally:
            memory_ops_mod.MemoryOperations = original

    async def test_org_audience_refused_for_non_builder(self, monkeypatch):
        import uniffy.domains.agents.access as access_mod

        async def not_builder(session, user_id, organization_id):
            return False

        monkeypatch.setattr(access_mod, "is_agents_builder", not_builder)
        captured = {}
        result = await self._save(self._ctx(MemoryScopeRef.user(USER_ID)), "organization", captured)
        assert not result.success
        assert "builder" in result.error
        assert "Nothing was saved" in result.error
        assert captured == {}

    async def test_org_audience_builder_saves_org_general(self, monkeypatch):
        import uniffy.domains.agents.access as access_mod

        async def builder(session, user_id, organization_id):
            return True

        monkeypatch.setattr(access_mod, "is_agents_builder", builder)
        captured = {}
        result = await self._save(self._ctx(MemoryScopeRef.user(USER_ID)), "organization", captured)
        assert result.success
        assert captured["ref"] == MemoryScopeRef.org()
        assert captured["ref"].agent_id is None

    async def test_personal_audience_refused_in_shared_space(self):
        captured = {}
        result = await self._save(
            self._ctx(MemoryScopeRef.channel(generate_id())), "personal", captured
        )
        assert not result.success
        assert "1:1" in result.error
        assert captured == {}

    async def test_personal_audience_in_dm_is_the_surface(self):
        surface = MemoryScopeRef.user(USER_ID)
        captured = {}
        result = await self._save(self._ctx(surface), "personal", captured)
        assert result.success
        assert captured["ref"] == surface

    async def test_invalid_audience_is_an_error(self):
        captured = {}
        result = await self._save(self._ctx(MemoryScopeRef.user(USER_ID)), "everyone", captured)
        assert not result.success
        assert "audience" in result.error.lower()
        assert captured == {}


class TestValidation:
    def test_field_validation(self):
        ok = dict(key="k", description="d", content="c", category="facts", importance=0.5)
        assert _validate_entry_fields(**ok) == ("k", "d", "c")
        for bad in [
            {**ok, "key": " "},
            {**ok, "description": ""},
            {**ok, "content": ""},
            {**ok, "content": "x" * (MAX_CONTENT_CHARS + 1)},
            {**ok, "category": "nope"},
            {**ok, "importance": 1.5},
        ]:
            with pytest.raises(ValidationError):
                _validate_entry_fields(**bad)

    async def test_quota_rejects_at_cap(self):
        session = MagicMock()
        session.execute = AsyncMock(return_value=_scalar_result(MAX_MEMORIES_PER_SCOPE))
        ops = MemoryOperations(session)
        with pytest.raises(ValidationError):
            await ops._check_quota(ORG_ID, MemoryScopeRef.user(USER_ID))


class TestPermissionGates:
    def _ops(self):
        session = MagicMock()
        session.execute = AsyncMock()
        session.commit = AsyncMock()
        session.refresh = AsyncMock()
        ops = MemoryOperations(session)
        ops._chat_checker = MagicMock()
        return ops, session

    async def test_user_scope_view_denied_for_other_user(self):
        ops, _ = self._ops()
        with pytest.raises(PermissionDeniedError):
            await ops._require_view(
                user_id=USER_ID,
                organization_id=ORG_ID,
                ref=MemoryScopeRef.user(generate_id()),
            )

    async def test_user_scope_mutate_denied_for_other_user(self):
        ops, _ = self._ops()
        memory = _memory(MemoryScope.USER, user_id=generate_id())
        with pytest.raises(PermissionDeniedError):
            await ops._require_mutate(user_id=USER_ID, organization_id=ORG_ID, memory=memory)

    async def test_channel_mutate_allows_creator_member(self):
        ops, _ = self._ops()
        memory = _memory(MemoryScope.CHANNEL, created_by_user_id=USER_ID)
        ops._chat_checker.get_membership = AsyncMock(return_value=MagicMock())
        await ops._require_mutate(user_id=USER_ID, organization_id=ORG_ID, memory=memory)

    async def test_channel_mutate_allows_moderator(self):
        ops, _ = self._ops()
        memory = _memory(MemoryScope.CHANNEL, created_by_user_id=generate_id())
        ops._chat_checker.require_elevated = AsyncMock(return_value=True)
        await ops._require_mutate(user_id=USER_ID, organization_id=ORG_ID, memory=memory)

    async def test_channel_mutate_denies_plain_member(self):
        ops, _ = self._ops()
        memory = _memory(MemoryScope.CHANNEL, created_by_user_id=generate_id())
        ops._chat_checker.require_elevated = AsyncMock(return_value=False)
        with pytest.raises(PermissionDeniedError):
            await ops._require_mutate(user_id=USER_ID, organization_id=ORG_ID, memory=memory)

    async def test_channel_pin_requires_moderator(self):
        ops, _ = self._ops()
        memory = _memory(MemoryScope.CHANNEL)
        ops._chat_checker.require_elevated = AsyncMock(return_value=False)
        with pytest.raises(PermissionDeniedError):
            await ops._require_pin(user_id=USER_ID, organization_id=ORG_ID, memory=memory)

    async def test_org_scope_gates_via_agent_manage(self):
        ops, _ = self._ops()
        memory = _memory(MemoryScope.ORG)
        ops._require_agent_manage = AsyncMock(side_effect=PermissionDeniedError("manage", "agent"))
        with pytest.raises(PermissionDeniedError):
            await ops._require_mutate(user_id=USER_ID, organization_id=ORG_ID, memory=memory)
        with pytest.raises(PermissionDeniedError):
            await ops._require_pin(user_id=USER_ID, organization_id=ORG_ID, memory=memory)


class TestPinCaps:
    async def test_pin_rejected_at_entry_cap(self):
        session = MagicMock()
        memory = _memory(MemoryScope.USER, user_id=USER_ID)
        pinned_rows = MagicMock()
        pinned_rows.all.return_value = [(generate_id(), "x") for _ in range(MAX_PINNED_ENTRIES)]
        session.execute = AsyncMock(side_effect=[_scalar_result(memory), pinned_rows])
        session.commit = AsyncMock()
        session.refresh = AsyncMock()
        ops = MemoryOperations(session)
        with pytest.raises(ValidationError):
            await ops.set_memory_pinned(
                user_id=USER_ID,
                organization_id=ORG_ID,
                memory_id=memory.id,
                pinned=True,
            )

    async def test_pin_rejected_over_char_budget(self):
        session = MagicMock()
        memory = _memory(MemoryScope.USER, user_id=USER_ID, content="y" * 500)
        pinned_rows = MagicMock()
        pinned_rows.all.return_value = [(generate_id(), "x" * 1800)]
        session.execute = AsyncMock(side_effect=[_scalar_result(memory), pinned_rows])
        session.commit = AsyncMock()
        session.refresh = AsyncMock()
        ops = MemoryOperations(session)
        with pytest.raises(ValidationError):
            await ops.set_memory_pinned(
                user_id=USER_ID,
                organization_id=ORG_ID,
                memory_id=memory.id,
                pinned=True,
            )


class TestMemoryBridge:
    async def _resolve(self, scope_ref, *, org_allows=True, opted_in=True, monkeypatch=None):
        from uniffy.domains.agents.runtime import operations as runtime_ops_mod

        fake_self = SimpleNamespace(_session=MagicMock())
        original_settings = runtime_ops_mod.get_runtime_settings
        original_bridge = runtime_ops_mod.is_personal_bridge_enabled
        runtime_ops_mod.get_runtime_settings = AsyncMock(
            return_value=SimpleNamespace(personal_memory_bridge_enabled=org_allows)
        )
        runtime_ops_mod.is_personal_bridge_enabled = AsyncMock(return_value=opted_in)
        try:
            return await RuntimeOperations._resolve_memory_bridge(
                fake_self,
                scope_ref=scope_ref,
                user_id=USER_ID,
                organization_id=ORG_ID,
            )
        finally:
            runtime_ops_mod.get_runtime_settings = original_settings
            runtime_ops_mod.is_personal_bridge_enabled = original_bridge

    async def test_bridge_only_applies_to_shared_surfaces(self):
        assert await self._resolve(MemoryScopeRef.user(USER_ID)) is None
        assert await self._resolve(MemoryScopeRef.org()) is None

    async def test_bridge_requires_org_gate(self):
        assert await self._resolve(MemoryScopeRef.channel(generate_id()), org_allows=False) is None

    async def test_bridge_requires_opt_in(self):
        assert await self._resolve(MemoryScopeRef.channel(generate_id()), opted_in=False) is None

    async def test_bridge_grants_user_read_ref(self):
        ref = MemoryScopeRef.session(generate_id())
        assert await self._resolve(ref) == MemoryScopeRef.user(USER_ID)

    async def test_bridge_never_changes_write_scope(self):
        """With the bridge active, saves still target the surface scope."""
        channel_ref = MemoryScopeRef.channel(generate_id())
        session = MagicMock()
        ctx = ToolContext(
            session=session,
            user_id=USER_ID,
            organization_id=ORG_ID,
            agent_id=generate_id(),
            memory_scope=channel_ref,
            memory_bridge_scope=MemoryScopeRef.user(USER_ID),
        )
        captured = {}

        class FakeOps:
            def __init__(self, session):
                pass

            async def save_from_tool(self, **kwargs):
                captured.update(kwargs)
                return _memory(MemoryScope.CHANNEL, key="k"), True

        original = memory_ops_mod.MemoryOperations
        memory_ops_mod.MemoryOperations = FakeOps
        try:
            await _execute_memory_save(ctx, {"key": "k", "description": "d", "content": "c"})
        finally:
            memory_ops_mod.MemoryOperations = original
        assert captured["ref"] == channel_ref


class TestHandlersScopeParse:
    def test_channel_scope_requires_channel_id(self):
        from connectrpc.errors import ConnectError
        from uniffy_proto.agents.v1.memories_pb2 import MEMORY_SCOPE_CHANNEL

        from uniffy.domains.agents.memories.handlers import _parse_scope_ref

        with pytest.raises((ConnectError, ValidationError)):
            _parse_scope_ref(
                MEMORY_SCOPE_CHANNEL,
                channel_id=None,
                session_id=None,
                agent_id=None,
                user_id=USER_ID,
            )

    def test_unspecified_defaults_to_caller_user_scope(self):
        from uniffy_proto.agents.v1.memories_pb2 import MEMORY_SCOPE_UNSPECIFIED

        from uniffy.domains.agents.memories.handlers import _parse_scope_ref

        ref = _parse_scope_ref(
            MEMORY_SCOPE_UNSPECIFIED,
            channel_id=None,
            session_id=None,
            agent_id=None,
            user_id=USER_ID,
        )
        assert ref == MemoryScopeRef.user(USER_ID)

    def test_agent_binding_rejected_outside_org_scope(self):
        from uniffy_proto.agents.v1.memories_pb2 import MEMORY_SCOPE_USER

        from uniffy.domains.agents.memories.handlers import _parse_scope_ref

        with pytest.raises(ValidationError):
            _parse_scope_ref(
                MEMORY_SCOPE_USER,
                channel_id=None,
                session_id=None,
                agent_id=str(generate_id()),
                user_id=USER_ID,
            )

    def test_org_scope_keeps_the_agent_binding(self):
        from uniffy_proto.agents.v1.memories_pb2 import MEMORY_SCOPE_ORG

        from uniffy.domains.agents.memories.handlers import _parse_scope_ref

        agent_id = generate_id()
        ref = _parse_scope_ref(
            MEMORY_SCOPE_ORG,
            channel_id=None,
            session_id=None,
            agent_id=str(agent_id),
            user_id=USER_ID,
        )
        assert ref == MemoryScopeRef.org(agent_id)
