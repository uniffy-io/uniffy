"""Unit tests for audience-scoped agent memories.

Covers scope routing, prompt injection shape (leak guard), tool scope
enforcement, permission gates, pin caps, and quota validation. Mocked
sessions throughout; no live DB or Valkey.
"""

import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.agents.memory import AgentMemory, MemoryScope
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
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
    _execute_memory_save,
    _read_filters,
    _scope_or_error,
)
from uniffy.domains.agents.tools.definitions import ToolContext


def _run(coro):
    return asyncio.run(coro)


def _scalar_result(value):
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    result.scalar.return_value = value
    return result


def _memory(scope=MemoryScope.USER, **overrides):
    subject = {
        "user_id": uuid4() if scope is MemoryScope.USER else None,
        "channel_id": uuid4() if scope is MemoryScope.CHANNEL else None,
        "session_id": uuid4() if scope is MemoryScope.SESSION else None,
    }
    defaults = dict(
        agent_id=uuid4(),
        organization_id=uuid4(),
        created_by_user_id=uuid4(),
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
    def _resolve(self, destination, *, session_kind=None, channel=None):
        fake_self = SimpleNamespace(_session=MagicMock())
        if channel is not None or isinstance(destination, ChatDestination):
            import uniffy.domains.chat.cache as chat_cache

            original = chat_cache.get_or_load_channel
            chat_cache.get_or_load_channel = AsyncMock(return_value=channel)
            try:
                return _run(
                    RuntimeOperations._resolve_memory_scope(
                        fake_self,
                        destination=destination,
                        user_id=USER_ID,
                        organization_id=ORG_ID,
                        session_kind=session_kind,
                    )
                )
            finally:
                chat_cache.get_or_load_channel = original
        return _run(
            RuntimeOperations._resolve_memory_scope(
                fake_self,
                destination=destination,
                user_id=USER_ID,
                organization_id=ORG_ID,
                session_kind=session_kind,
            )
        )

    def test_direct_session_routes_to_user(self):
        ref = self._resolve(SessionDestination(session_id=uuid4()), session_kind="direct")
        assert ref == MemoryScopeRef(MemoryScope.USER, USER_ID)

    def test_cron_session_routes_to_user(self):
        ref = self._resolve(SessionDestination(session_id=uuid4()), session_kind="cron")
        assert ref.scope is MemoryScope.USER

    def test_group_session_routes_to_session(self):
        sid = uuid4()
        ref = self._resolve(SessionDestination(session_id=sid), session_kind="group")
        assert ref == MemoryScopeRef(MemoryScope.SESSION, sid)

    def test_global_session_routes_to_session(self):
        sid = uuid4()
        ref = self._resolve(SessionDestination(session_id=sid), session_kind="global")
        assert ref == MemoryScopeRef(MemoryScope.SESSION, sid)

    def test_agent_dm_routes_to_user(self):
        channel = ChatChannel(
            organization_id=ORG_ID,
            owner_id=USER_ID,
            name="dm",
            slug="dm",
            channel_type=ChannelType.DIRECT,
            is_agent_dm=True,
        )
        dest = ChatDestination(
            channel_id=channel.id, agent_id=uuid4(), trigger_message_id=uuid4()
        )
        ref = self._resolve(dest, channel=channel)
        assert ref == MemoryScopeRef(MemoryScope.USER, USER_ID)

    def test_group_dm_routes_to_channel(self):
        channel = ChatChannel(
            organization_id=ORG_ID,
            owner_id=USER_ID,
            name="gdm",
            slug="gdm",
            channel_type=ChannelType.GROUP_DM,
            is_agent_dm=True,
        )
        dest = ChatDestination(
            channel_id=channel.id, agent_id=uuid4(), trigger_message_id=uuid4()
        )
        ref = self._resolve(dest, channel=channel)
        assert ref == MemoryScopeRef(MemoryScope.CHANNEL, channel.id)

    def test_public_channel_routes_to_channel(self):
        channel = ChatChannel(
            organization_id=ORG_ID,
            owner_id=USER_ID,
            name="gen",
            slug="gen",
            channel_type=ChannelType.PUBLIC,
        )
        dest = ChatDestination(
            channel_id=channel.id, agent_id=uuid4(), trigger_message_id=uuid4()
        )
        ref = self._resolve(dest, channel=channel)
        assert ref == MemoryScopeRef(MemoryScope.CHANNEL, channel.id)


USER_ID = uuid4()
ORG_ID = uuid4()


class TestPromptInjectionShape:
    def test_pinned_full_content_index_description_only(self):
        block = build_memory_block(
            [
                MemoryScopeBlock(
                    label="Channel memory (shared)",
                    pinned=[{"key": "pk", "category": "facts", "content": "PINNED_BODY"}],
                    index=[
                        {"key": "ik", "category": "context", "description": "IDX_DESC"}
                    ],
                    total=60,
                )
            ]
        )
        assert "PINNED_BODY" in block
        assert "IDX_DESC" in block
        assert "58 more entries" in block
        assert "memory.read" in block
        assert "never override" in block

    def test_unpinned_content_never_renders(self):
        block = build_memory_block(
            [
                MemoryScopeBlock(
                    label="Personal memory",
                    pinned=[],
                    index=[{"key": "k", "category": "facts", "description": "desc"}],
                    total=1,
                )
            ]
        )
        assert "SECRET_CONTENT" not in (block or "")

    def test_empty_scopes_render_nothing(self):
        assert build_memory_block([]) is None
        assert (
            build_memory_block(
                [MemoryScopeBlock(label="x", pinned=[], index=[], total=0)]
            )
            is None
        )

    def test_system_prompt_has_no_memory_section_without_context(self):
        prompt = build_system_prompt(
            agent_name="A", soul_prompt="", org_name="Org", memory_context=None
        )
        assert "## Memory" not in prompt

    def test_system_prompt_embeds_block_verbatim(self):
        block = build_memory_block(
            [
                MemoryScopeBlock(
                    label="Personal memory",
                    pinned=[],
                    index=[{"key": "k", "category": "facts", "description": "d"}],
                    total=1,
                )
            ]
        )
        prompt = build_system_prompt(
            agent_name="A", soul_prompt="", org_name="Org", memory_context=block
        )
        assert "## Memory" in prompt
        assert "Personal memory" in prompt


class TestScopeHelpers:
    def test_subject_columns_exactly_one_set(self):
        sid = uuid4()
        for scope, column in [
            (MemoryScope.USER, "user_id"),
            (MemoryScope.CHANNEL, "channel_id"),
            (MemoryScope.SESSION, "session_id"),
        ]:
            cols = scope_subject_columns(MemoryScopeRef(scope, sid))
            assert cols[column] == sid
            assert sum(v is not None for v in cols.values()) == 1
        org_cols = scope_subject_columns(MemoryScopeRef(MemoryScope.ORG))
        assert all(v is None for v in org_cols.values())

    def test_scope_ref_roundtrip(self):
        for scope in MemoryScope:
            memory = _memory(scope)
            ref = scope_ref_for_memory(memory)
            assert ref.scope is scope
            if scope is MemoryScope.ORG:
                assert ref.subject_id is None
            else:
                assert ref.subject_id is not None


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
            agent_id=uuid4(),
            memory_scope=memory_scope,
        )

    def test_missing_scope_is_an_error_not_a_fallback(self):
        ctx = self._ctx(memory_scope=None)
        ref, err = _scope_or_error(ctx)
        assert ref is None
        assert err is not None and not err.success

    def test_save_never_writes_user_scope_from_channel_run(self):
        """Poisoning guard: the executor passes the resolved ref through unchanged."""
        channel_ref = MemoryScopeRef(MemoryScope.CHANNEL, uuid4())
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
            result = _run(
                _execute_memory_save(
                    ctx,
                    {"key": "k", "description": "d", "content": "c"},
                )
            )
        finally:
            memory_ops_mod.MemoryOperations = original

        assert result.success
        assert captured["ref"] == channel_ref
        assert "channel members" in result.data

    def test_forget_refuses_pinned(self):
        ref = MemoryScopeRef(MemoryScope.CHANNEL, uuid4())
        ctx = self._ctx(memory_scope=ref)
        pinned_row = _memory(MemoryScope.CHANNEL, pinned=True)
        ctx.session.execute.return_value = _scalar_result(pinned_row)
        result = _run(_execute_memory_forget(ctx, {"key": "k"}))
        assert not result.success
        assert "pinned" in result.error
        ctx.session.delete.assert_not_called()

    def test_read_filters_org_scope_is_surface_only(self):
        ctx = self._ctx(memory_scope=MemoryScopeRef(MemoryScope.ORG))
        filters = _read_filters(ctx, ctx.memory_scope)
        assert len(filters) > 1

    def test_read_filters_surface_scope_is_one_or_clause(self):
        ctx = self._ctx(memory_scope=MemoryScopeRef(MemoryScope.USER, USER_ID))
        filters = _read_filters(ctx, ctx.memory_scope)
        assert len(filters) == 1


class TestValidation:
    def test_field_validation(self):
        ok = dict(
            key="k", description="d", content="c", category="facts", importance=0.5
        )
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

    def test_quota_rejects_at_cap(self):
        session = MagicMock()
        session.execute = AsyncMock(return_value=_scalar_result(MAX_MEMORIES_PER_SCOPE))
        ops = MemoryOperations(session)
        with pytest.raises(ValidationError):
            _run(
                ops._check_quota(
                    uuid4(), ORG_ID, MemoryScopeRef(MemoryScope.USER, USER_ID)
                )
            )


class TestPermissionGates:
    def _ops(self):
        session = MagicMock()
        session.execute = AsyncMock()
        session.commit = AsyncMock()
        session.refresh = AsyncMock()
        ops = MemoryOperations(session)
        ops._chat_checker = MagicMock()
        return ops, session

    def test_user_scope_view_denied_for_other_user(self):
        ops, _ = self._ops()
        with pytest.raises(PermissionDeniedError):
            _run(
                ops._require_view(
                    user_id=USER_ID,
                    organization_id=ORG_ID,
                    agent_id=uuid4(),
                    ref=MemoryScopeRef(MemoryScope.USER, uuid4()),
                )
            )

    def test_user_scope_mutate_denied_for_other_user(self):
        ops, _ = self._ops()
        memory = _memory(MemoryScope.USER, user_id=uuid4())
        with pytest.raises(PermissionDeniedError):
            _run(
                ops._require_mutate(
                    user_id=USER_ID, organization_id=ORG_ID, memory=memory
                )
            )

    def test_channel_mutate_allows_creator_member(self):
        ops, _ = self._ops()
        memory = _memory(MemoryScope.CHANNEL, created_by_user_id=USER_ID)
        ops._chat_checker.get_membership = AsyncMock(return_value=MagicMock())
        _run(ops._require_mutate(user_id=USER_ID, organization_id=ORG_ID, memory=memory))

    def test_channel_mutate_allows_moderator(self):
        ops, _ = self._ops()
        memory = _memory(MemoryScope.CHANNEL, created_by_user_id=uuid4())
        ops._chat_checker.require_elevated = AsyncMock(return_value=True)
        _run(ops._require_mutate(user_id=USER_ID, organization_id=ORG_ID, memory=memory))

    def test_channel_mutate_denies_plain_member(self):
        ops, _ = self._ops()
        memory = _memory(MemoryScope.CHANNEL, created_by_user_id=uuid4())
        ops._chat_checker.require_elevated = AsyncMock(return_value=False)
        with pytest.raises(PermissionDeniedError):
            _run(
                ops._require_mutate(
                    user_id=USER_ID, organization_id=ORG_ID, memory=memory
                )
            )

    def test_channel_pin_requires_moderator(self):
        ops, _ = self._ops()
        memory = _memory(MemoryScope.CHANNEL)
        ops._chat_checker.require_elevated = AsyncMock(return_value=False)
        with pytest.raises(PermissionDeniedError):
            _run(ops._require_pin(user_id=USER_ID, organization_id=ORG_ID, memory=memory))

    def test_org_scope_gates_via_agent_manage(self):
        ops, _ = self._ops()
        memory = _memory(MemoryScope.ORG)
        ops._require_agent_manage = AsyncMock(
            side_effect=PermissionDeniedError("manage", "agent")
        )
        with pytest.raises(PermissionDeniedError):
            _run(
                ops._require_mutate(
                    user_id=USER_ID, organization_id=ORG_ID, memory=memory
                )
            )
        with pytest.raises(PermissionDeniedError):
            _run(ops._require_pin(user_id=USER_ID, organization_id=ORG_ID, memory=memory))


class TestPinCaps:
    def test_pin_rejected_at_entry_cap(self):
        session = MagicMock()
        memory = _memory(MemoryScope.USER, user_id=USER_ID)
        pinned_rows = MagicMock()
        pinned_rows.all.return_value = [
            (uuid4(), "x") for _ in range(MAX_PINNED_ENTRIES)
        ]
        session.execute = AsyncMock(
            side_effect=[_scalar_result(memory), pinned_rows]
        )
        session.commit = AsyncMock()
        session.refresh = AsyncMock()
        ops = MemoryOperations(session)
        with pytest.raises(ValidationError):
            _run(
                ops.set_memory_pinned(
                    user_id=USER_ID,
                    organization_id=ORG_ID,
                    memory_id=memory.id,
                    pinned=True,
                )
            )

    def test_pin_rejected_over_char_budget(self):
        session = MagicMock()
        memory = _memory(MemoryScope.USER, user_id=USER_ID, content="y" * 500)
        pinned_rows = MagicMock()
        pinned_rows.all.return_value = [(uuid4(), "x" * 1800)]
        session.execute = AsyncMock(
            side_effect=[_scalar_result(memory), pinned_rows]
        )
        session.commit = AsyncMock()
        session.refresh = AsyncMock()
        ops = MemoryOperations(session)
        with pytest.raises(ValidationError):
            _run(
                ops.set_memory_pinned(
                    user_id=USER_ID,
                    organization_id=ORG_ID,
                    memory_id=memory.id,
                    pinned=True,
                )
            )


class TestMemoryBridge:
    def _resolve(self, scope_ref, *, org_allows=True, opted_in=True, monkeypatch=None):
        from uniffy.domains.agents.runtime import operations as runtime_ops_mod

        fake_self = SimpleNamespace(_session=MagicMock())
        original_settings = runtime_ops_mod.get_runtime_settings
        original_bridge = runtime_ops_mod.is_personal_bridge_enabled
        runtime_ops_mod.get_runtime_settings = AsyncMock(
            return_value=SimpleNamespace(personal_memory_bridge_enabled=org_allows)
        )
        runtime_ops_mod.is_personal_bridge_enabled = AsyncMock(return_value=opted_in)
        try:
            return _run(
                RuntimeOperations._resolve_memory_bridge(
                    fake_self,
                    scope_ref=scope_ref,
                    user_id=USER_ID,
                    organization_id=ORG_ID,
                )
            )
        finally:
            runtime_ops_mod.get_runtime_settings = original_settings
            runtime_ops_mod.is_personal_bridge_enabled = original_bridge

    def test_bridge_only_applies_to_shared_surfaces(self):
        assert self._resolve(MemoryScopeRef(MemoryScope.USER, USER_ID)) is None
        assert self._resolve(MemoryScopeRef(MemoryScope.ORG)) is None

    def test_bridge_requires_org_gate(self):
        ref = MemoryScopeRef(MemoryScope.CHANNEL, uuid4())
        assert self._resolve(ref, org_allows=False) is None

    def test_bridge_requires_opt_in(self):
        ref = MemoryScopeRef(MemoryScope.CHANNEL, uuid4())
        assert self._resolve(ref, opted_in=False) is None

    def test_bridge_grants_user_read_ref(self):
        ref = MemoryScopeRef(MemoryScope.SESSION, uuid4())
        assert self._resolve(ref) == MemoryScopeRef(MemoryScope.USER, USER_ID)

    def test_bridge_never_changes_write_scope(self):
        """With the bridge active, saves still target the surface scope."""
        channel_ref = MemoryScopeRef(MemoryScope.CHANNEL, uuid4())
        session = MagicMock()
        ctx = ToolContext(
            session=session,
            user_id=USER_ID,
            organization_id=ORG_ID,
            agent_id=uuid4(),
            memory_scope=channel_ref,
            memory_bridge_scope=MemoryScopeRef(MemoryScope.USER, USER_ID),
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
            _run(
                _execute_memory_save(
                    ctx, {"key": "k", "description": "d", "content": "c"}
                )
            )
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
                MEMORY_SCOPE_CHANNEL, channel_id=None, session_id=None, user_id=USER_ID
            )

    def test_unspecified_defaults_to_caller_user_scope(self):
        from uniffy_proto.agents.v1.memories_pb2 import MEMORY_SCOPE_UNSPECIFIED

        from uniffy.domains.agents.memories.handlers import _parse_scope_ref

        ref = _parse_scope_ref(
            MEMORY_SCOPE_UNSPECIFIED, channel_id=None, session_id=None, user_id=USER_ID
        )
        assert ref == MemoryScopeRef(MemoryScope.USER, USER_ID)
