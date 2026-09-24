from uniffy.core.converters.proto import timestamp_to_datetime

"""Unit tests for the agents-in-chat integration.

Covers the pure-logic + asyncio-only pieces that don't require a live DB or
Valkey: chat subjects, feature flag, sender resolver, mention detector,
agent-chat bridge guards, runtime writers + approvals, and chat-channel
agent context handlers + summariser.
"""

from contextlib import asynccontextmanager
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from uniffy_proto.chat.v1.chat_pb import (
    GetChannelAgentConfigRequest,
    UpdateChannelAgentConfigRequest,
)

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.json_codec import loads
from uniffy.core.models.agents.memory import MemoryScope
from uniffy.core.models.chat.channel import ChannelType
from uniffy.core.models.chat.message import SenderType
from uniffy.core.types import SubjectType, generate_id
from uniffy.domains.agents.bridge import (
    contexts as context_handlers_mod,
)
from uniffy.domains.agents.bridge.context import (
    ChatAgentContextOperations,
    ContextStats,
    _format_chat_entry,
)
from uniffy.domains.agents.bridge.contexts import (
    _parse_ids,
    _stats_to_proto,
)
from uniffy.domains.agents.bridge.mentions import (
    detect_agent_mentions,
)
from uniffy.domains.agents.bridge.operations import AgentChatBridge
from uniffy.domains.agents.memories.scope import MemoryScopeRef
from uniffy.domains.agents.runtime import stream as runtime_stream_mod
from uniffy.domains.agents.runtime.approvals import ApprovalStore
from uniffy.domains.agents.runtime.compactor import (
    SummaryResult,
    format_conversation_lines,
    summarise_conversation,
)
from uniffy.domains.agents.runtime.destinations import ChatDestination
from uniffy.domains.agents.runtime.models import resolver as model_resolver_mod
from uniffy.domains.agents.runtime.stream import MessageStreamer
from uniffy.domains.agents.runtime.writers import (
    ChatChannelMessageWriter,
    SessionMessageWriter,
    _metadata_kind_for,
)
from uniffy.domains.chat.policies.operations import _from_blob
from uniffy.domains.chat.senders import SenderInfo, SenderResolver
from uniffy.domains.chat.subjects import ChatSubject


def _fake_user_row(uid: UUID, name: str, avatar: str | None = None, username: str = ""):
    return (uid, name, avatar, username)


def _fake_agent_row(aid: UUID, name: str, avatar_key: str | None, emoji: str | None):
    return (aid, name, avatar_key, emoji)


class _FakeResult:
    """Minimal async-result shim supporting .all() and .one_or_none()."""

    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows

    def one_or_none(self):
        return self._rows[0] if self._rows else None


def _chat_msg(
    *,
    msg_id: UUID | None = None,
    sender_id: UUID,
    sender_type: SenderType = SenderType.USER,
    content: str = "",
    metadata: dict | None = None,
) -> SimpleNamespace:
    """Lightweight ChatMessage shim - only attribute access is exercised."""
    return SimpleNamespace(
        id=msg_id or generate_id(),
        sender_id=sender_id,
        sender_type=sender_type,
        content=content,
        message_metadata=metadata or {},
    )


def _stats(
    *,
    manual_reset_at: datetime | None = None,
    was_reset: bool = False,
) -> ContextStats:
    return ContextStats(
        total_messages=42,
        active_messages=30,
        compacted_messages=12,
        summary_count=2,
        active_tokens=1234,
        last_input_tokens=1000,
        last_output_tokens=234,
        last_cache_read_tokens=800,
        token_budget=130_000,
        tokens_until_compaction=128_766,
        context_window_tokens=200_000,
        was_reset=was_reset,
        manual_reset_at=manual_reset_at,
    )


def _bridge_with_missing_trigger() -> AgentChatBridge:
    """Bridge whose session returns None for any `get(...)` - exercises the missing-trigger guard."""
    session = MagicMock()
    session.get = AsyncMock(return_value=None)
    return AgentChatBridge(session, MagicMock())


class TestChatSubject:
    def test_user_and_agent_constructors(self) -> None:
        uid = generate_id()
        aid = generate_id()
        assert ChatSubject.user(uid) == ChatSubject(SubjectType.USER, uid)
        assert ChatSubject.agent(aid) == ChatSubject(SubjectType.AGENT, aid)

    def test_as_key_matches_pk_order(self) -> None:
        uid = generate_id()
        s = ChatSubject.user(uid)
        assert s.as_key == ("USER", uid)

    def test_set_dedup_by_identity(self) -> None:
        uid = generate_id()
        subjects = {ChatSubject.user(uid), ChatSubject.user(uid)}
        assert len(subjects) == 1

    def test_sort_stable(self) -> None:
        a = ChatSubject(SubjectType.AGENT, UUID(int=1))
        b = ChatSubject(SubjectType.USER, UUID(int=2))
        ordered = sorted([b, a], key=lambda s: s.as_key)
        assert ordered[0] == a
        assert ordered[1] == b


class TestFeatureFlag:
    def test_missing_key_defaults_to_enabled(self) -> None:
        assert _from_blob(generate_id(), {}).agents_enabled is True

    def test_flag_on(self) -> None:
        assert _from_blob(generate_id(), {"agents_enabled": True}).agents_enabled is True

    def test_flag_explicit_false(self) -> None:
        assert _from_blob(generate_id(), {"agents_enabled": False}).agents_enabled is False


class TestSenderResolver:
    async def test_resolve_many_splits_user_and_agent(self) -> None:
        session = MagicMock()
        uid = generate_id()
        aid = generate_id()

        async def fake_execute(stmt):
            txt = str(stmt)
            if "login_users" in txt:
                return _FakeResult([_fake_user_row(uid, "Alice", "avatar/a")])
            return _FakeResult([_fake_agent_row(aid, "Writer", None, ":robot:")])

        session.execute = AsyncMock(side_effect=fake_execute)
        resolver = SenderResolver(session)

        async def go():
            return await resolver.resolve_many([(SenderType.USER, uid), (SenderType.AGENT, aid)])

        out = await go()
        assert out[uid].display_name == "Alice"
        assert out[aid].display_name == "Writer"
        assert out[aid].avatar_emoji == ":robot:"
        # One query per type, not per sender.
        assert session.execute.await_count == 2

    async def test_cache_hit_skips_second_query(self) -> None:
        session = MagicMock()
        uid = generate_id()
        session.execute = AsyncMock(return_value=_FakeResult([_fake_user_row(uid, "Alice")]))
        resolver = SenderResolver(session)

        async def go():
            await resolver.resolve_many([(SenderType.USER, uid)])
            await resolver.resolve_many([(SenderType.USER, uid)])

        await go()
        assert session.execute.await_count == 1

    async def test_missing_sender_returns_fallback(self) -> None:
        session = MagicMock()
        session.execute = AsyncMock(return_value=_FakeResult([]))
        resolver = SenderResolver(session)

        info = await resolver.resolve_one(SenderType.USER, generate_id())
        assert isinstance(info, SenderInfo)
        assert info.display_name == "Unknown"

    async def test_empty_refs_no_queries(self) -> None:
        session = MagicMock()
        session.execute = AsyncMock()
        resolver = SenderResolver(session)

        out = await resolver.resolve_many([])
        assert out == {}
        assert session.execute.await_count == 0


class TestMentionDetector:
    async def test_non_user_trigger_returns_empty(self) -> None:
        message = MagicMock()
        message.sender_type = SenderType.AGENT
        channel = MagicMock()
        session = MagicMock()

        out = await detect_agent_mentions(session, message, channel)
        assert out == []

    async def test_no_agent_members_returns_empty(self) -> None:
        message = MagicMock()
        message.sender_type = SenderType.USER
        message.mentioned_agent_ids = None
        channel = MagicMock()
        channel.id = generate_id()
        session = MagicMock()
        session.execute = AsyncMock(return_value=_FakeResult([]))

        out = await detect_agent_mentions(session, message, channel)
        assert out == []

    async def test_dm_rule_when_solo_agent_member(self) -> None:
        aid = generate_id()
        message = MagicMock()
        message.sender_type = SenderType.USER
        message.mentioned_agent_ids = None
        message.reply_to_id = None
        message.root_id = None
        channel = MagicMock()
        channel.id = generate_id()
        channel.channel_type = ChannelType.DIRECT
        session = MagicMock()
        session.execute = AsyncMock(return_value=_FakeResult([(aid,)]))

        out = await detect_agent_mentions(session, message, channel)
        assert [(m.agent_id, m.rule) for m in out] == [(aid, "dm")]

    async def test_mention_rule_matches_channel_member(self) -> None:
        member_aid = generate_id()
        other_aid = generate_id()
        message = MagicMock()
        message.sender_type = SenderType.USER
        message.mentioned_agent_ids = [member_aid, other_aid]
        message.reply_to_id = None
        message.root_id = None
        channel = MagicMock()
        channel.id = generate_id()
        channel.channel_type = ChannelType.PUBLIC
        session = MagicMock()
        session.execute = AsyncMock(return_value=_FakeResult([(member_aid,)]))

        out = await detect_agent_mentions(session, message, channel)
        assert len(out) == 1
        assert out[0].agent_id == member_aid
        assert out[0].rule == "mention"

    async def test_reply_rule_fires_without_re_mention(self) -> None:
        agent_id = generate_id()
        parent_id = generate_id()
        message = MagicMock()
        message.sender_type = SenderType.USER
        message.mentioned_agent_ids = None
        message.reply_to_id = parent_id
        message.root_id = None
        channel = MagicMock()
        channel.id = generate_id()
        channel.channel_type = ChannelType.PRIVATE

        async def fake_execute(stmt):
            txt = str(stmt)
            if "chat_channel_members" in txt:
                return _FakeResult([(agent_id,)])
            return _FakeResult([(SenderType.AGENT, agent_id)])

        session = MagicMock()
        session.execute = AsyncMock(side_effect=fake_execute)

        out = await detect_agent_mentions(session, message, channel)
        assert [(m.agent_id, m.rule) for m in out] == [(agent_id, "reply")]

    async def test_reply_rule_not_fired_for_non_member_parent(self) -> None:
        non_member = generate_id()
        member = generate_id()
        parent_id = generate_id()
        message = MagicMock()
        message.sender_type = SenderType.USER
        message.mentioned_agent_ids = None
        message.reply_to_id = parent_id
        message.root_id = None
        channel = MagicMock()
        channel.id = generate_id()
        channel.channel_type = ChannelType.PRIVATE

        async def fake_execute(stmt):
            txt = str(stmt)
            if "chat_channel_members" in txt:
                return _FakeResult([(member,)])
            return _FakeResult([(SenderType.AGENT, non_member)])

        session = MagicMock()
        session.execute = AsyncMock(side_effect=fake_execute)

        out = await detect_agent_mentions(session, message, channel)
        assert out == []

    async def test_mention_and_dm_do_not_duplicate(self) -> None:
        aid = generate_id()
        message = MagicMock()
        message.sender_type = SenderType.USER
        message.mentioned_agent_ids = [aid]
        message.reply_to_id = None
        message.root_id = None
        channel = MagicMock()
        channel.id = generate_id()
        channel.channel_type = ChannelType.DIRECT
        session = MagicMock()
        session.execute = AsyncMock(return_value=_FakeResult([(aid,)]))

        out = await detect_agent_mentions(session, message, channel)
        # DM rule wins the first pass; mention rule skips because the agent
        # is already matched.
        assert len(out) == 1
        assert out[0].rule == "dm"

    async def test_thread_rule_fires_when_root_is_agent(self) -> None:
        agent_id = generate_id()
        root_id = generate_id()
        message = MagicMock()
        message.sender_type = SenderType.USER
        message.mentioned_agent_ids = None
        message.reply_to_id = None
        message.root_id = root_id
        channel = MagicMock()
        channel.id = generate_id()
        channel.channel_type = ChannelType.PRIVATE

        async def fake_execute(stmt):
            txt = str(stmt)
            if "chat_channel_members" in txt:
                return _FakeResult([(agent_id,)])
            return _FakeResult([(SenderType.AGENT, agent_id)])

        session = MagicMock()
        session.execute = AsyncMock(side_effect=fake_execute)

        out = await detect_agent_mentions(session, message, channel)
        assert [(m.agent_id, m.rule) for m in out] == [(agent_id, "thread")]


class TestAgentChatBridgeStub:
    async def test_respond_to_chat_message_returns_when_trigger_missing(self) -> None:
        bridge = _bridge_with_missing_trigger()
        await bridge.respond_to_chat_message(
            channel_id=generate_id(),
            trigger_message_id=generate_id(),
            agent_id=generate_id(),
            storage=MagicMock(),
            search_indexer=MagicMock(),
            call_lifecycle=MagicMock(),
        )

    async def test_handle_confirmation_decision_raises_when_state_missing(self) -> None:
        bridge = AgentChatBridge(MagicMock(), MagicMock())
        with pytest.raises(NotFoundError):
            await bridge.handle_confirmation_decision(
                request_id=generate_id(),
                channel_id=generate_id(),
                message_id=generate_id(),
                decision="approved",
                decided_by=generate_id(),
                rationale=None,
            )


class TestMetadataKindMapping:
    def test_summary_role(self) -> None:
        assert _metadata_kind_for("summary", None) == "summary"

    def test_tool_role(self) -> None:
        assert _metadata_kind_for("tool", "tc_123") == "tool_result"

    def test_assistant_with_tool_call_id(self) -> None:
        assert _metadata_kind_for("assistant", "tc_123") == "tool_call"

    def test_assistant_without_tool_call_id(self) -> None:
        assert _metadata_kind_for("assistant", None) == "final"

    def test_user_falls_back_to_final(self) -> None:
        # The writer short-circuits role=="user" before invoking the helper;
        # the mapper itself returns "final" as a safe default.
        assert _metadata_kind_for("user", None) == "final"


class TestApprovalStoreInProcess:
    async def test_register_then_respond_approved(self) -> None:
        store = ApprovalStore()
        scope = generate_id()
        rid = "tc_abc"

        async def flow() -> bool | None:
            await store.register(scope, rid, tool_name="notes.delete_note")
            resolved = await store.respond(scope, rid, True, decided_by=generate_id())
            assert resolved is True
            return await store.wait_for_response(scope, rid, timeout=1.0)

        assert await flow() is True

    async def test_respond_denied_resolves_false(self) -> None:
        store = ApprovalStore()
        scope = generate_id()
        rid = "tc_def"

        async def flow() -> bool | None:
            await store.register(scope, rid)
            await store.respond(scope, rid, False)
            return await store.wait_for_response(scope, rid, timeout=1.0)

        assert await flow() is False

    async def test_respond_without_register_does_not_crash(self) -> None:
        """Respond on an unknown scope is tolerant and returns cleanly."""
        store = ApprovalStore()

        async def flow() -> bool:
            return await store.respond(generate_id(), "tc_ghost", True)

        # No local event so `resolved_locally` is False; `cache_set` is a
        # graceful no-op when Valkey is unavailable, leaving `valkey_ok` True.
        # Either way the call completes without raising.
        await flow()

    async def test_wait_times_out_without_respond(self) -> None:
        store = ApprovalStore()
        scope = generate_id()
        rid = "tc_slow"

        async def flow() -> bool | None:
            await store.register(scope, rid)
            return await store.wait_for_response(scope, rid, timeout=0.05)

        assert await flow() is None


class TestChatWriterApprovalAccessors:
    def _writer(self) -> tuple[ChatChannelMessageWriter, dict[str, UUID]]:
        ids = {
            "channel": generate_id(),
            "agent": generate_id(),
            "user": generate_id(),
            "trigger": generate_id(),
            "org": generate_id(),
        }
        return (
            ChatChannelMessageWriter(
                session=MagicMock(),
                search_indexer=MagicMock(),
                user_id=ids["user"],
                organization_id=ids["org"],
                channel_id=ids["channel"],
                agent_id=ids["agent"],
                trigger_message_id=ids["trigger"],
            ),
            ids,
        )

    def test_approval_scope_is_channel(self) -> None:
        w, ids = self._writer()
        assert w.approval_scope_id == ids["channel"]

    def test_approval_hints_feed_audit_path(self) -> None:
        w, ids = self._writer()
        assert w.approval_actor_user_id == ids["user"]
        assert w.approval_agent_id == ids["agent"]
        assert w.approval_channel_id == ids["channel"]


class TestSessionWriterApprovalAccessors:
    def test_scope_is_session_and_actor_is_user(self) -> None:
        session_id = generate_id()
        user_id = generate_id()
        w = SessionMessageWriter(
            session_ops=MagicMock(),
            user_id=user_id,
            organization_id=generate_id(),
            session_id=session_id,
        )
        assert w.approval_scope_id == session_id
        # RespondToConfirmation gates on this matching the caller's id;
        # returning None would lock the human out of their own approval.
        assert w.approval_actor_user_id == user_id
        assert w.approval_agent_id is None
        assert w.approval_channel_id is None


class TestStatsToProto:
    def test_maps_all_scalar_fields(self) -> None:
        proto = _stats_to_proto(_stats())
        assert proto.total_messages == 42
        assert proto.active_messages == 30
        assert proto.compacted_messages == 12
        assert proto.summary_count == 2
        assert proto.active_tokens == 1234
        assert proto.last_input_tokens == 1000
        assert proto.last_output_tokens == 234
        assert proto.last_cache_read_tokens == 800
        assert proto.token_budget == 130_000
        assert proto.tokens_until_compaction == 128_766
        assert proto.context_window_tokens == 200_000
        assert proto.was_reset is False

    def test_omits_manual_reset_at_when_none(self) -> None:
        proto = _stats_to_proto(_stats(manual_reset_at=None))
        assert not proto.has_field("manual_reset_at")

    def test_serialises_manual_reset_at_when_set(self) -> None:
        when = datetime(2026, 4, 23, 12, 30, 0, tzinfo=UTC)
        proto = _stats_to_proto(_stats(manual_reset_at=when, was_reset=True))
        assert proto.has_field("manual_reset_at")
        assert timestamp_to_datetime(proto.manual_reset_at) == when
        assert proto.was_reset is True


class TestParseIds:
    def test_returns_uuids_in_order(self) -> None:
        a = generate_id()
        b = generate_id()
        c = generate_id()
        out = _parse_ids(str(a), str(b), str(c))
        assert out == [a, b, c]

    def test_rejects_garbage(self) -> None:
        with pytest.raises(ConnectError) as exc:
            _parse_ids(str(generate_id()), "not-a-uuid", str(generate_id()))
        assert exc.value.code == Code.INVALID_ARGUMENT

    def test_rejects_empty(self) -> None:
        with pytest.raises(ConnectError) as exc:
            _parse_ids("")
        assert exc.value.code == Code.INVALID_ARGUMENT


class TestFormatConversationLines:
    def test_skips_empty_content(self) -> None:
        out = format_conversation_lines([("USER", "hi"), ("ASSISTANT", ""), ("TOOL", "ok")])
        assert out == "USER: hi\nTOOL: ok"

    def test_returns_empty_string_when_all_empty(self) -> None:
        assert format_conversation_lines([("USER", ""), ("TOOL", "")]) == ""


class TestSummariseConversation:
    async def test_returns_none_when_entries_empty(self) -> None:
        provider = MagicMock()
        result = await summarise_conversation(provider=provider, model="x", entries=[])
        assert result is None
        provider.chat_completion.assert_not_called()

    async def test_returns_none_when_provider_returns_empty(self) -> None:
        async def _fake(messages, model, system):
            return SimpleNamespace(content="", input_tokens=10, output_tokens=0)

        provider = SimpleNamespace(chat_completion=_fake)
        result = await summarise_conversation(
            provider=provider,
            model="x",
            entries=[("USER", "hello")],
        )
        assert result is None

    async def test_returns_summary_result(self) -> None:
        async def _fake(messages, model, system):
            assert "hello" in messages[0]["content"]
            return SimpleNamespace(content="summary", input_tokens=11, output_tokens=22)

        provider = SimpleNamespace(chat_completion=_fake)
        result = await summarise_conversation(
            provider=provider,
            model="x",
            entries=[("USER", "hello")],
        )
        assert isinstance(result, SummaryResult)
        assert result.content == "summary"
        assert result.input_tokens == 11
        assert result.output_tokens == 22


class TestFormatChatEntry:
    def test_self_agent_assistant_unprefixed(self) -> None:
        agent_id = generate_id()
        m = _chat_msg(
            sender_id=agent_id,
            sender_type=SenderType.AGENT,
            content="hi",
            metadata={"kind": "final"},
        )
        assert _format_chat_entry(m, {}, agent_id) == ("ASSISTANT", "hi")

    def test_other_agent_uses_resolved_name(self) -> None:
        self_aid = generate_id()
        other_aid = generate_id()
        m = _chat_msg(
            sender_id=other_aid,
            sender_type=SenderType.AGENT,
            content="hello",
            metadata={"kind": "final"},
        )
        out = _format_chat_entry(m, {other_aid: "Other"}, self_aid)
        assert out == ("[Other]", "hello")

    def test_user_uses_resolved_name(self) -> None:
        agent_id = generate_id()
        uid = generate_id()
        m = _chat_msg(sender_id=uid, sender_type=SenderType.USER, content="ping")
        out = _format_chat_entry(m, {uid: "Alice"}, agent_id)
        assert out == ("[Alice]", "ping")

    def test_tool_call_label(self) -> None:
        agent_id = generate_id()
        m = _chat_msg(
            sender_id=agent_id,
            sender_type=SenderType.AGENT,
            content="searching",
            metadata={"kind": "tool_call", "tool_name": "notes.search"},
        )
        label, body = _format_chat_entry(m, {}, agent_id)
        assert label == "ASSISTANT"
        assert body.startswith("[Tool call: notes.search]")

    def test_tool_result_label(self) -> None:
        agent_id = generate_id()
        m = _chat_msg(
            sender_id=agent_id,
            sender_type=SenderType.AGENT,
            content="3 hits",
            metadata={"kind": "tool_result", "tool_name": "notes.search"},
        )
        label, body = _format_chat_entry(m, {}, agent_id)
        assert label == "TOOL"
        assert body.startswith("[Tool result: notes.search]")


def _binding_row(
    *,
    model_override: str | None = None,
    model_params_override: dict | None = None,
    image_params_override: dict | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        channel_id=generate_id(),
        agent_id=generate_id(),
        model_override=model_override,
        model_params_override=model_params_override,
        image_params_override=image_params_override,
        loaded_tool_groups=[],
    )


def _config_ops(
    binding: SimpleNamespace,
    *,
    channel_type: ChannelType = ChannelType.DIRECT,
    provider_name: str = "anthropic",
    effective_model: str = "claude-fable-5",
):
    session = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    access = MagicMock()
    ops = ChatAgentContextOperations(session, access)
    channel = SimpleNamespace(id=generate_id(), channel_type=channel_type)
    agent = SimpleNamespace(id=generate_id(), name="Helper")
    ops._load_triple = AsyncMock(return_value=(channel, agent, binding))
    ops._resolve_provider_and_model = AsyncMock(
        return_value=(SimpleNamespace(name=provider_name), effective_model)
    )
    return ops, session, access


class TestChannelAgentConfigOps:
    def _ids(self) -> dict[str, UUID]:
        return {
            "user_id": generate_id(),
            "organization_id": generate_id(),
            "channel_id": generate_id(),
            "agent_id": generate_id(),
        }

    async def test_get_config_returns_binding_after_read_gate(self) -> None:
        binding = _binding_row(model_override="claude-x")
        ops, _session, access = _config_ops(binding)
        access.check_access = AsyncMock()

        out = await ops.get_config(**self._ids())
        assert out is binding
        access.check_access.assert_awaited_once()

    async def test_update_config_sets_model_override(self) -> None:
        binding = _binding_row()
        ops, session, access = _config_ops(binding)
        access.get_membership = AsyncMock(return_value=SimpleNamespace())

        out = await ops.update_config(
            **self._ids(),
            model_override="  gpt-5.4  ",
        )
        assert out is binding
        assert binding.model_override == "gpt-5.4"
        session.commit.assert_awaited_once()

    async def test_update_config_none_leaves_fields_unchanged(self) -> None:
        binding = _binding_row(model_override="keep-me")
        ops, _session, access = _config_ops(binding)
        access.get_membership = AsyncMock(return_value=SimpleNamespace())

        await ops.update_config(**self._ids(), model_override=None)
        assert binding.model_override == "keep-me"

    async def test_update_config_empty_values_clear(self) -> None:
        binding = _binding_row(model_override="old-model")
        ops, _session, access = _config_ops(binding)
        access.get_membership = AsyncMock(return_value=SimpleNamespace())

        await ops.update_config(**self._ids(), model_override="  ")
        assert binding.model_override is None

    async def test_update_config_denied_for_dm_non_member(self) -> None:
        binding = _binding_row(model_override="keep-me")
        ops, session, access = _config_ops(binding)
        access.get_membership = AsyncMock(return_value=None)

        with pytest.raises(PermissionDeniedError):
            await ops.update_config(
                **self._ids(),
                model_override="new-model",
            )
        assert binding.model_override == "keep-me"
        session.commit.assert_not_awaited()

    async def test_update_config_stores_params_valid_for_effective_model(self) -> None:
        binding = _binding_row()
        ops, session, access = _config_ops(binding)
        access.get_membership = AsyncMock(return_value=SimpleNamespace())

        await ops.update_config(
            **self._ids(),
            model_params_override={"reasoning_effort": "max"},
        )
        assert binding.model_params_override == {"reasoning_effort": "max"}
        ops._resolve_provider_and_model.assert_awaited_once()
        session.commit.assert_awaited_once()

    async def test_update_config_rejects_out_of_schema_params(self) -> None:
        binding = _binding_row(model_params_override={"reasoning_effort": "max"})
        ops, session, access = _config_ops(binding)
        access.get_membership = AsyncMock(return_value=SimpleNamespace())

        # claude-fable-5 rejects the temperature knob.
        with pytest.raises(ValidationError):
            await ops.update_config(
                **self._ids(),
                model_params_override={"temperature": 0.4},
            )
        assert binding.model_params_override == {"reasoning_effort": "max"}
        session.commit.assert_not_awaited()

    async def test_update_config_empty_params_clear_without_resolution(self) -> None:
        binding = _binding_row(model_params_override={"reasoning_effort": "max"})
        ops, _session, access = _config_ops(binding)
        access.get_membership = AsyncMock(return_value=SimpleNamespace())

        await ops.update_config(**self._ids(), model_params_override={})
        assert binding.model_params_override is None
        ops._resolve_provider_and_model.assert_not_awaited()

    async def test_update_config_model_switch_strips_invalid_params(self) -> None:
        binding = _binding_row(
            model_override="gpt-4o",
            model_params_override={"temperature": 0.4, "reasoning_effort": "max"},
        )
        ops, _session, access = _config_ops(binding)
        access.get_membership = AsyncMock(return_value=SimpleNamespace())

        await ops.update_config(**self._ids(), model_override="claude-fable-5")
        assert binding.model_params_override == {"reasoning_effort": "max"}

    async def test_update_config_same_model_leaves_params_alone(self) -> None:
        binding = _binding_row(
            model_override="claude-fable-5",
            model_params_override={"reasoning_effort": "max"},
        )
        ops, _session, access = _config_ops(binding)
        access.get_membership = AsyncMock(return_value=SimpleNamespace())

        await ops.update_config(**self._ids(), model_override="claude-fable-5")
        assert binding.model_params_override == {"reasoning_effort": "max"}
        ops._resolve_provider_and_model.assert_not_awaited()

    async def test_update_config_strip_keeps_params_when_unresolvable(self) -> None:
        binding = _binding_row(
            model_override="old-model",
            model_params_override={"reasoning_effort": "max"},
        )
        ops, _session, access = _config_ops(binding)
        access.get_membership = AsyncMock(return_value=SimpleNamespace())
        ops._resolve_provider_and_model = AsyncMock(
            side_effect=ValidationError("model", "nothing configured")
        )

        await ops.update_config(**self._ids(), model_override="new-model")
        # The send path strips per-request; an unresolvable target must not
        # wipe the stored overrides.
        assert binding.model_params_override == {"reasoning_effort": "max"}


class _FakeConfigOps:
    def __init__(self, binding: SimpleNamespace) -> None:
        self.binding = binding
        self.get_calls: list[dict] = []
        self.update_calls: list[dict] = []

    async def get_config(self, **kwargs) -> SimpleNamespace:
        self.get_calls.append(kwargs)
        return self.binding

    async def update_config(self, **kwargs) -> SimpleNamespace:
        self.update_calls.append(kwargs)
        return self.binding


def _install_config_handler_env(
    monkeypatch,
    *,
    binding: SimpleNamespace,
    enabled: bool = True,
    user_id: UUID | None = None,
) -> _FakeConfigOps:
    @asynccontextmanager
    async def fake_open_session():
        yield MagicMock()

    async def fake_flag(_session, _org_id) -> bool:
        return enabled

    ops = _FakeConfigOps(binding)
    monkeypatch.setattr(context_handlers_mod, "open_session", fake_open_session)
    monkeypatch.setattr(context_handlers_mod, "is_chat_agents_enabled", fake_flag)
    monkeypatch.setattr(
        context_handlers_mod,
        "current_user_id",
        lambda: user_id or generate_id(),
    )
    monkeypatch.setattr(context_handlers_mod, "ChatAgentContextOperations", lambda _session: ops)
    return ops


class TestChannelAgentConfigHandlers:
    def _request_ids(self) -> dict[str, str]:
        return {
            "organization_id": str(generate_id()),
            "channel_id": str(generate_id()),
            "agent_id": str(generate_id()),
        }

    async def test_get_config_happy_path(self, monkeypatch) -> None:
        binding = _binding_row(
            model_override="claude-sonnet-5",
            model_params_override={"reasoning_effort": "max"},
        )
        fake_ops = _install_config_handler_env(monkeypatch, binding=binding)
        handlers = context_handlers_mod.ChannelAgentContextHandlers()

        response = await handlers.get_channel_agent_config(
            GetChannelAgentConfigRequest(**self._request_ids()), MagicMock()
        )
        assert response.config.model_override == "claude-sonnet-5"
        assert loads(response.config.model_params_override) == {"reasoning_effort": "max"}
        assert len(fake_ops.get_calls) == 1

    async def test_get_config_empty_binding_serialises_empty_strings(self, monkeypatch) -> None:
        fake_ops = _install_config_handler_env(monkeypatch, binding=_binding_row())
        handlers = context_handlers_mod.ChannelAgentContextHandlers()

        response = await handlers.get_channel_agent_config(
            GetChannelAgentConfigRequest(**self._request_ids()), MagicMock()
        )
        assert response.config.model_override == ""
        assert response.config.model_params_override == ""
        assert response.config.image_params_override == ""
        assert len(fake_ops.get_calls) == 1

    async def test_update_config_passes_set_values_to_ops(self, monkeypatch) -> None:
        fake_ops = _install_config_handler_env(monkeypatch, binding=_binding_row())
        handlers = context_handlers_mod.ChannelAgentContextHandlers()

        await handlers.update_channel_agent_config(
            UpdateChannelAgentConfigRequest(
                **self._request_ids(),
                model_override="gpt-5.4",
                model_params_override='{"temperature": 0.4}',
                image_params_override='{"resolution": "2K"}',
            ),
            MagicMock(),
        )
        call = fake_ops.update_calls[0]
        assert call["model_override"] == "gpt-5.4"
        assert call["model_params_override"] == {"temperature": 0.4}
        assert call["image_params_override"] == {"resolution": "2K"}

    async def test_update_config_present_empty_clears(self, monkeypatch) -> None:
        fake_ops = _install_config_handler_env(monkeypatch, binding=_binding_row())
        handlers = context_handlers_mod.ChannelAgentContextHandlers()

        await handlers.update_channel_agent_config(
            UpdateChannelAgentConfigRequest(
                **self._request_ids(),
                model_override="",
                model_params_override="",
                image_params_override="",
            ),
            MagicMock(),
        )
        call = fake_ops.update_calls[0]
        assert call["model_override"] == ""
        assert call["model_params_override"] == {}
        assert call["image_params_override"] == {}

    async def test_update_config_absent_fields_stay_unchanged(self, monkeypatch) -> None:
        fake_ops = _install_config_handler_env(monkeypatch, binding=_binding_row())
        handlers = context_handlers_mod.ChannelAgentContextHandlers()

        await handlers.update_channel_agent_config(
            UpdateChannelAgentConfigRequest(**self._request_ids()), MagicMock()
        )
        call = fake_ops.update_calls[0]
        assert call["model_override"] is None
        assert call["model_params_override"] is None
        assert call["image_params_override"] is None

    async def test_update_config_rejects_malformed_params_json(self, monkeypatch) -> None:
        fake_ops = _install_config_handler_env(monkeypatch, binding=_binding_row())
        handlers = context_handlers_mod.ChannelAgentContextHandlers()

        with pytest.raises(ConnectError) as exc:
            await handlers.update_channel_agent_config(
                UpdateChannelAgentConfigRequest(
                    **self._request_ids(),
                    model_params_override="not-json",
                ),
                MagicMock(),
            )
        assert exc.value.code == Code.INVALID_ARGUMENT
        assert fake_ops.update_calls == []

    async def test_update_config_rejects_non_object_params_json(self, monkeypatch) -> None:
        fake_ops = _install_config_handler_env(monkeypatch, binding=_binding_row())
        handlers = context_handlers_mod.ChannelAgentContextHandlers()

        with pytest.raises(ConnectError) as exc:
            await handlers.update_channel_agent_config(
                UpdateChannelAgentConfigRequest(
                    **self._request_ids(),
                    model_params_override="[1, 2]",
                ),
                MagicMock(),
            )
        assert exc.value.code == Code.INVALID_ARGUMENT
        assert fake_ops.update_calls == []

    async def test_flag_off_raises_failed_precondition(self, monkeypatch) -> None:
        fake_ops = _install_config_handler_env(monkeypatch, binding=_binding_row(), enabled=False)
        handlers = context_handlers_mod.ChannelAgentContextHandlers()

        with pytest.raises(ConnectError) as exc:
            await handlers.get_channel_agent_config(
                GetChannelAgentConfigRequest(**self._request_ids()), MagicMock()
            )
        assert exc.value.code == Code.FAILED_PRECONDITION

        with pytest.raises(ConnectError) as exc:
            await handlers.update_channel_agent_config(
                UpdateChannelAgentConfigRequest(**self._request_ids()),
                MagicMock(),
            )
        assert exc.value.code == Code.FAILED_PRECONDITION
        assert fake_ops.get_calls == []
        assert fake_ops.update_calls == []


class _StopFlow(Exception):
    """Sentinel aborting the stream immediately after parameter resolution."""


def _stream_agent(
    *,
    primary_provider_key_id: UUID | None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=generate_id(),
        name="Helper",
        soul_prompt="",
        primary_model="agent-primary",
        primary_provider_key_id=primary_provider_key_id,
        fallback_models=[],
        model_params={"temperature": 0.7},
        enabled_tools=[],
        enabled_skills=[],
        enabled_rules=[],
    )


def _stream_runtime_ops(monkeypatch, *, binding_row, agent):
    captured: dict = {}

    ops = object.__new__(MessageStreamer)
    ops._session_factory = MagicMock()
    ops._search_indexer = MagicMock()
    session = MagicMock()

    async def fake_execute(_stmt):
        return SimpleNamespace(scalar_one_or_none=lambda: binding_row)

    session.execute = AsyncMock(side_effect=fake_execute)
    ops._session = session
    ops._org_operations = SimpleNamespace(
        require_org_member=AsyncMock(return_value=SimpleNamespace(role="member")),
        get_by_id=AsyncMock(return_value=SimpleNamespace(name="Org")),
    )
    ops._user_operations = SimpleNamespace(
        get_by_id=AsyncMock(return_value=SimpleNamespace(full_name="Alice", username="alice"))
    )
    ops._agent_operations = SimpleNamespace(get_for_runtime=AsyncMock(return_value=agent))
    provider = SimpleNamespace(name="anthropic")
    provider_key = SimpleNamespace(id=generate_id())

    async def fake_key_and_provider_for_model(*, organization_id, model_id):
        captured["provider_lookup_model"] = model_id
        return provider, provider_key

    ops._provider_operations = SimpleNamespace(
        get_provider_for_key=AsyncMock(return_value=(provider, provider_key)),
        get_key_and_provider_for_model=AsyncMock(side_effect=fake_key_and_provider_for_model),
    )
    ops._session_operations = MagicMock()
    ops._skill_operations = MagicMock()
    ops._memory = SimpleNamespace(
        resolve_scope=AsyncMock(return_value=MemoryScopeRef(MemoryScope.CHANNEL, generate_id())),
        resolve_bridge=AsyncMock(return_value=None),
        build_context=AsyncMock(return_value=None),
    )
    ops._chat = SimpleNamespace(build_channel=AsyncMock(return_value=None))

    async def fake_resolve_model(**kwargs):
        captured["resolve_model"] = kwargs
        return "resolved-model"

    def fake_resolve_request_params(agent_params, override_params, provider_name, model_id):
        captured["request_params"] = {
            "agent_params": agent_params,
            "override_params": override_params,
            "provider": provider_name,
            "model_id": model_id,
        }
        raise _StopFlow()

    monkeypatch.setattr(runtime_stream_mod, "resolve_enabled_rules", AsyncMock(return_value=()))
    monkeypatch.setattr(runtime_stream_mod, "resolve_invoked_skill", AsyncMock(return_value=None))
    monkeypatch.setattr(runtime_stream_mod, "build_system_prompt", lambda **_kwargs: "sys")
    monkeypatch.setattr(runtime_stream_mod, "get_tool_registry", lambda: MagicMock())
    monkeypatch.setattr(model_resolver_mod, "resolve_model", fake_resolve_model)
    monkeypatch.setattr(runtime_stream_mod, "resolve_request_params", fake_resolve_request_params)
    return ops, session, captured


async def _run_chat_stream_until_params(ops) -> None:
    destination = ChatDestination(
        channel_id=generate_id(), agent_id=generate_id(), trigger_message_id=generate_id()
    )

    async def go() -> None:
        agen = ops.stream(
            user_id=generate_id(),
            organization_id=generate_id(),
            destination=destination,
            content="hello",
        )
        await agen.__anext__()

    with pytest.raises(_StopFlow):
        await go()


class TestChatStreamBindingOverrides:
    async def test_binding_overrides_thread_into_resolution(self, monkeypatch) -> None:
        binding = _binding_row(
            model_override="channel-model",
            model_params_override={"temperature": 0.1},
        )
        agent = _stream_agent(primary_provider_key_id=generate_id())
        ops, session, captured = _stream_runtime_ops(monkeypatch, binding_row=binding, agent=agent)

        await _run_chat_stream_until_params(ops)

        assert captured["resolve_model"]["session_model_override"] == "channel-model"
        assert captured["request_params"]["agent_params"] == {"temperature": 0.7}
        assert captured["request_params"]["override_params"] == {"temperature": 0.1}
        assert captured["request_params"]["provider"] == "anthropic"
        assert captured["request_params"]["model_id"] == "resolved-model"
        # One indexed SELECT for the binding, nothing else on the session.
        assert session.execute.await_count == 1

    def test_binding_params_merge_over_agent_params(self) -> None:
        # gpt-4o accepts both knobs; the binding value must win on collision.
        merged = runtime_stream_mod.resolve_request_params(
            {"temperature": 0.7, "top_p": 0.9},
            {"temperature": 0.1},
            "openai",
            "gpt-4o",
        )
        assert merged == {"temperature": 0.1, "top_p": 0.9}

    async def test_binding_override_drives_provider_lookup_without_pinned_key(
        self, monkeypatch
    ) -> None:
        binding = _binding_row(model_override="channel-model")
        agent = _stream_agent(primary_provider_key_id=None)
        ops, _session, captured = _stream_runtime_ops(monkeypatch, binding_row=binding, agent=agent)

        await _run_chat_stream_until_params(ops)

        assert captured["provider_lookup_model"] == "channel-model"
        assert captured["resolve_model"]["session_model_override"] == "channel-model"

    async def test_missing_binding_row_means_no_overrides(self, monkeypatch) -> None:
        agent = _stream_agent(primary_provider_key_id=generate_id())
        ops, _session, captured = _stream_runtime_ops(monkeypatch, binding_row=None, agent=agent)

        await _run_chat_stream_until_params(ops)

        assert captured["resolve_model"]["session_model_override"] is None
        assert captured["request_params"]["agent_params"] == {"temperature": 0.7}
        assert captured["request_params"]["override_params"] is None
