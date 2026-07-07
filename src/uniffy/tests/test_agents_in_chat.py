"""Unit tests for the agents-in-chat integration.

Covers the pure-logic + asyncio-only pieces that don't require a live DB or
Valkey: chat subjects, feature flag, sender resolver, mention detector,
agent-chat bridge guards, runtime writers + approvals, and chat-channel
agent context handlers + summariser.
"""

import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError

from uniffy.core.errors import NotFoundError
from uniffy.core.models.chat.channel import ChannelType
from uniffy.core.models.chat.message import SenderType
from uniffy.core.types import SubjectType
from uniffy.core.types import generate_id as uuid7
from uniffy.domains.agents.chat_integration.context import (
    ContextStats,
    _format_chat_entry,
)
from uniffy.domains.agents.chat_integration.context_handlers import (
    _parse_ids,
    _stats_to_proto,
)
from uniffy.domains.agents.chat_integration.mention_detector import (
    detect_agent_mentions,
)
from uniffy.domains.agents.chat_integration.operations import AgentChatBridge
from uniffy.domains.agents.runtime.approvals import ApprovalStore
from uniffy.domains.agents.runtime.compactor import (
    SummaryResult,
    format_conversation_lines,
    summarise_conversation,
)
from uniffy.domains.agents.runtime.writers import (
    ChatChannelMessageWriter,
    SessionMessageWriter,
    _metadata_kind_for,
)
from uniffy.domains.chat.feature_flags import is_chat_agents_enabled_on
from uniffy.domains.chat.sender_resolver import SenderInfo, SenderResolver
from uniffy.domains.chat.subjects import ChatSubject


def _run(coro):
    """Run an awaitable in a fresh event loop (no pytest-asyncio dep)."""
    return asyncio.run(coro)


def _fake_user_row(
    uid: UUID, name: str, avatar: str | None = None, username: str = ""
):
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
        id=msg_id or uuid7(),
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
    return AgentChatBridge(session)


class TestChatSubject:
    def test_user_and_agent_constructors(self) -> None:
        uid = uuid7()
        aid = uuid7()
        assert ChatSubject.user(uid) == ChatSubject(SubjectType.USER, uid)
        assert ChatSubject.agent(aid) == ChatSubject(SubjectType.AGENT, aid)

    def test_as_key_matches_pk_order(self) -> None:
        uid = uuid7()
        s = ChatSubject.user(uid)
        assert s.as_key == ("USER", uid)

    def test_set_dedup_by_identity(self) -> None:
        uid = uuid7()
        subjects = {ChatSubject.user(uid), ChatSubject.user(uid)}
        assert len(subjects) == 1

    def test_sort_stable(self) -> None:
        a = ChatSubject(SubjectType.AGENT, UUID(int=1))
        b = ChatSubject(SubjectType.USER, UUID(int=2))
        ordered = sorted([b, a], key=lambda s: s.as_key)
        assert ordered[0] == a
        assert ordered[1] == b


class TestFeatureFlag:
    def test_missing_settings_returns_false(self) -> None:
        org = MagicMock()
        org.settings = None
        assert is_chat_agents_enabled_on(org) is False

    def test_missing_chat_key_returns_false(self) -> None:
        org = MagicMock()
        org.settings = {"notes": {"x": True}}
        assert is_chat_agents_enabled_on(org) is False

    def test_flag_on(self) -> None:
        org = MagicMock()
        org.settings = {"chat": {"agents_enabled": True}}
        assert is_chat_agents_enabled_on(org) is True

    def test_flag_explicit_false(self) -> None:
        org = MagicMock()
        org.settings = {"chat": {"agents_enabled": False}}
        assert is_chat_agents_enabled_on(org) is False


class TestSenderResolver:
    def test_resolve_many_splits_user_and_agent(self) -> None:
        session = MagicMock()
        uid = uuid7()
        aid = uuid7()

        async def fake_execute(stmt):
            txt = str(stmt)
            if "login_users" in txt:
                return _FakeResult([_fake_user_row(uid, "Alice", "avatar/a")])
            return _FakeResult([_fake_agent_row(aid, "Writer", None, ":robot:")])

        session.execute = AsyncMock(side_effect=fake_execute)
        resolver = SenderResolver(session)

        async def go():
            return await resolver.resolve_many([(SenderType.USER, uid), (SenderType.AGENT, aid)])

        out = _run(go())
        assert out[uid].display_name == "Alice"
        assert out[aid].display_name == "Writer"
        assert out[aid].avatar_emoji == ":robot:"
        # One query per type, not per sender.
        assert session.execute.await_count == 2

    def test_cache_hit_skips_second_query(self) -> None:
        session = MagicMock()
        uid = uuid7()
        session.execute = AsyncMock(return_value=_FakeResult([_fake_user_row(uid, "Alice")]))
        resolver = SenderResolver(session)

        async def go():
            await resolver.resolve_many([(SenderType.USER, uid)])
            await resolver.resolve_many([(SenderType.USER, uid)])

        _run(go())
        assert session.execute.await_count == 1

    def test_missing_sender_returns_fallback(self) -> None:
        session = MagicMock()
        session.execute = AsyncMock(return_value=_FakeResult([]))
        resolver = SenderResolver(session)

        info = _run(resolver.resolve_one(SenderType.USER, uuid7()))
        assert isinstance(info, SenderInfo)
        assert info.display_name == "Unknown"

    def test_empty_refs_no_queries(self) -> None:
        session = MagicMock()
        session.execute = AsyncMock()
        resolver = SenderResolver(session)

        out = _run(resolver.resolve_many([]))
        assert out == {}
        assert session.execute.await_count == 0


class TestMentionDetector:
    def test_non_user_trigger_returns_empty(self) -> None:
        message = MagicMock()
        message.sender_type = SenderType.AGENT
        channel = MagicMock()
        session = MagicMock()

        out = _run(detect_agent_mentions(session, message, channel))
        assert out == []

    def test_no_agent_members_returns_empty(self) -> None:
        message = MagicMock()
        message.sender_type = SenderType.USER
        message.mentioned_agent_ids = None
        channel = MagicMock()
        channel.id = uuid7()
        session = MagicMock()
        session.execute = AsyncMock(return_value=_FakeResult([]))

        out = _run(detect_agent_mentions(session, message, channel))
        assert out == []

    def test_dm_rule_when_solo_agent_member(self) -> None:
        aid = uuid7()
        message = MagicMock()
        message.sender_type = SenderType.USER
        message.mentioned_agent_ids = None
        message.reply_to_id = None
        message.root_id = None
        channel = MagicMock()
        channel.id = uuid7()
        channel.channel_type = ChannelType.DIRECT
        session = MagicMock()
        session.execute = AsyncMock(return_value=_FakeResult([(aid,)]))

        out = _run(detect_agent_mentions(session, message, channel))
        assert [(m.agent_id, m.rule) for m in out] == [(aid, "dm")]

    def test_mention_rule_matches_channel_member(self) -> None:
        member_aid = uuid7()
        other_aid = uuid7()
        message = MagicMock()
        message.sender_type = SenderType.USER
        message.mentioned_agent_ids = [member_aid, other_aid]
        message.reply_to_id = None
        message.root_id = None
        channel = MagicMock()
        channel.id = uuid7()
        channel.channel_type = ChannelType.PUBLIC
        session = MagicMock()
        session.execute = AsyncMock(return_value=_FakeResult([(member_aid,)]))

        out = _run(detect_agent_mentions(session, message, channel))
        assert len(out) == 1
        assert out[0].agent_id == member_aid
        assert out[0].rule == "mention"

    def test_reply_rule_fires_without_re_mention(self) -> None:
        agent_id = uuid7()
        parent_id = uuid7()
        message = MagicMock()
        message.sender_type = SenderType.USER
        message.mentioned_agent_ids = None
        message.reply_to_id = parent_id
        message.root_id = None
        channel = MagicMock()
        channel.id = uuid7()
        channel.channel_type = ChannelType.PRIVATE

        async def fake_execute(stmt):
            txt = str(stmt)
            if "chat_channel_members" in txt:
                return _FakeResult([(agent_id,)])
            return _FakeResult([(SenderType.AGENT, agent_id)])

        session = MagicMock()
        session.execute = AsyncMock(side_effect=fake_execute)

        out = _run(detect_agent_mentions(session, message, channel))
        assert [(m.agent_id, m.rule) for m in out] == [(agent_id, "reply")]

    def test_reply_rule_not_fired_for_non_member_parent(self) -> None:
        non_member = uuid7()
        member = uuid7()
        parent_id = uuid7()
        message = MagicMock()
        message.sender_type = SenderType.USER
        message.mentioned_agent_ids = None
        message.reply_to_id = parent_id
        message.root_id = None
        channel = MagicMock()
        channel.id = uuid7()
        channel.channel_type = ChannelType.PRIVATE

        async def fake_execute(stmt):
            txt = str(stmt)
            if "chat_channel_members" in txt:
                return _FakeResult([(member,)])
            return _FakeResult([(SenderType.AGENT, non_member)])

        session = MagicMock()
        session.execute = AsyncMock(side_effect=fake_execute)

        out = _run(detect_agent_mentions(session, message, channel))
        assert out == []

    def test_mention_and_dm_do_not_duplicate(self) -> None:
        aid = uuid7()
        message = MagicMock()
        message.sender_type = SenderType.USER
        message.mentioned_agent_ids = [aid]
        message.reply_to_id = None
        message.root_id = None
        channel = MagicMock()
        channel.id = uuid7()
        channel.channel_type = ChannelType.DIRECT
        session = MagicMock()
        session.execute = AsyncMock(return_value=_FakeResult([(aid,)]))

        out = _run(detect_agent_mentions(session, message, channel))
        # DM rule wins the first pass; mention rule skips because the agent
        # is already matched.
        assert len(out) == 1
        assert out[0].rule == "dm"

    def test_thread_rule_fires_when_root_is_agent(self) -> None:
        agent_id = uuid7()
        root_id = uuid7()
        message = MagicMock()
        message.sender_type = SenderType.USER
        message.mentioned_agent_ids = None
        message.reply_to_id = None
        message.root_id = root_id
        channel = MagicMock()
        channel.id = uuid7()
        channel.channel_type = ChannelType.PRIVATE

        async def fake_execute(stmt):
            txt = str(stmt)
            if "chat_channel_members" in txt:
                return _FakeResult([(agent_id,)])
            return _FakeResult([(SenderType.AGENT, agent_id)])

        session = MagicMock()
        session.execute = AsyncMock(side_effect=fake_execute)

        out = _run(detect_agent_mentions(session, message, channel))
        assert [(m.agent_id, m.rule) for m in out] == [(agent_id, "thread")]


class TestAgentChatBridgeStub:
    def test_respond_to_chat_message_returns_when_trigger_missing(self) -> None:
        bridge = _bridge_with_missing_trigger()
        _run(
            bridge.respond_to_chat_message(
                channel_id=uuid7(),
                trigger_message_id=uuid7(),
                agent_id=uuid7(),
            )
        )

    def test_handle_confirmation_decision_raises_when_state_missing(self) -> None:
        bridge = AgentChatBridge(MagicMock())
        with pytest.raises(NotFoundError):
            _run(
                bridge.handle_confirmation_decision(
                    request_id=uuid7(),
                    channel_id=uuid7(),
                    message_id=uuid7(),
                    decision="approved",
                    decided_by=uuid7(),
                    rationale=None,
                )
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
    def test_register_then_respond_approved(self) -> None:
        store = ApprovalStore()
        scope = uuid7()
        rid = "tc_abc"

        async def flow() -> bool | None:
            await store.register(scope, rid, tool_name="notes.delete_note")
            resolved = await store.respond(scope, rid, True, decided_by=uuid7())
            assert resolved is True
            return await store.wait_for_response(scope, rid, timeout=1.0)

        assert _run(flow()) is True

    def test_respond_denied_resolves_false(self) -> None:
        store = ApprovalStore()
        scope = uuid7()
        rid = "tc_def"

        async def flow() -> bool | None:
            await store.register(scope, rid)
            await store.respond(scope, rid, False)
            return await store.wait_for_response(scope, rid, timeout=1.0)

        assert _run(flow()) is False

    def test_respond_without_register_does_not_crash(self) -> None:
        """Respond on an unknown scope is tolerant and returns cleanly."""
        store = ApprovalStore()

        async def flow() -> bool:
            return await store.respond(uuid7(), "tc_ghost", True)

        # No local event so `resolved_locally` is False; `cache_set` is a
        # graceful no-op when Valkey is unavailable, leaving `valkey_ok` True.
        # Either way the call completes without raising.
        _run(flow())

    def test_wait_times_out_without_respond(self) -> None:
        store = ApprovalStore()
        scope = uuid7()
        rid = "tc_slow"

        async def flow() -> bool | None:
            await store.register(scope, rid)
            return await store.wait_for_response(scope, rid, timeout=0.05)

        assert _run(flow()) is None


class TestChatWriterApprovalAccessors:
    def _writer(self) -> tuple[ChatChannelMessageWriter, dict[str, UUID]]:
        ids = {
            "channel": uuid7(),
            "agent": uuid7(),
            "user": uuid7(),
            "trigger": uuid7(),
            "org": uuid7(),
        }
        return (
            ChatChannelMessageWriter(
                session=MagicMock(),
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
        session_id = uuid7()
        user_id = uuid7()
        w = SessionMessageWriter(
            session_ops=MagicMock(),
            user_id=user_id,
            organization_id=uuid7(),
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
        assert not proto.HasField("manual_reset_at")

    def test_serialises_manual_reset_at_when_set(self) -> None:
        when = datetime(2026, 4, 23, 12, 30, 0, tzinfo=UTC)
        proto = _stats_to_proto(_stats(manual_reset_at=when, was_reset=True))
        assert proto.HasField("manual_reset_at")
        assert proto.manual_reset_at.ToDatetime(tzinfo=UTC) == when
        assert proto.was_reset is True


class TestParseIds:
    def test_returns_uuids_in_order(self) -> None:
        a = uuid7()
        b = uuid7()
        c = uuid7()
        out = _parse_ids(str(a), str(b), str(c))
        assert out == [a, b, c]

    def test_rejects_garbage(self) -> None:
        with pytest.raises(ConnectError) as exc:
            _parse_ids(str(uuid7()), "not-a-uuid", str(uuid7()))
        assert exc.value.code == Code.INVALID_ARGUMENT

    def test_rejects_empty(self) -> None:
        with pytest.raises(ConnectError) as exc:
            _parse_ids("")
        assert exc.value.code == Code.INVALID_ARGUMENT


class TestFormatConversationLines:
    def test_skips_empty_content(self) -> None:
        out = format_conversation_lines(
            [("USER", "hi"), ("ASSISTANT", ""), ("TOOL", "ok")]
        )
        assert out == "USER: hi\nTOOL: ok"

    def test_returns_empty_string_when_all_empty(self) -> None:
        assert format_conversation_lines([("USER", ""), ("TOOL", "")]) == ""


class TestSummariseConversation:
    def test_returns_none_when_entries_empty(self) -> None:
        provider = MagicMock()
        result = _run(
            summarise_conversation(provider=provider, model="x", entries=[])
        )
        assert result is None
        provider.chat_completion.assert_not_called()

    def test_returns_none_when_provider_returns_empty(self) -> None:
        async def _fake(messages, model, system):
            return SimpleNamespace(content="", input_tokens=10, output_tokens=0)

        provider = SimpleNamespace(chat_completion=_fake)
        result = _run(
            summarise_conversation(
                provider=provider,
                model="x",
                entries=[("USER", "hello")],
            )
        )
        assert result is None

    def test_returns_summary_result(self) -> None:
        async def _fake(messages, model, system):
            assert "hello" in messages[0]["content"]
            return SimpleNamespace(content="summary", input_tokens=11, output_tokens=22)

        provider = SimpleNamespace(chat_completion=_fake)
        result = _run(
            summarise_conversation(
                provider=provider,
                model="x",
                entries=[("USER", "hello")],
            )
        )
        assert isinstance(result, SummaryResult)
        assert result.content == "summary"
        assert result.input_tokens == 11
        assert result.output_tokens == 22


class TestFormatChatEntry:
    def test_self_agent_assistant_unprefixed(self) -> None:
        agent_id = uuid7()
        m = _chat_msg(
            sender_id=agent_id,
            sender_type=SenderType.AGENT,
            content="hi",
            metadata={"kind": "final"},
        )
        assert _format_chat_entry(m, {}, agent_id) == ("ASSISTANT", "hi")

    def test_other_agent_uses_resolved_name(self) -> None:
        self_aid = uuid7()
        other_aid = uuid7()
        m = _chat_msg(
            sender_id=other_aid,
            sender_type=SenderType.AGENT,
            content="hello",
            metadata={"kind": "final"},
        )
        out = _format_chat_entry(m, {other_aid: "Other"}, self_aid)
        assert out == ("[Other]", "hello")

    def test_user_uses_resolved_name(self) -> None:
        agent_id = uuid7()
        uid = uuid7()
        m = _chat_msg(sender_id=uid, sender_type=SenderType.USER, content="ping")
        out = _format_chat_entry(m, {uid: "Alice"}, agent_id)
        assert out == ("[Alice]", "ping")

    def test_tool_call_label(self) -> None:
        agent_id = uuid7()
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
        agent_id = uuid7()
        m = _chat_msg(
            sender_id=agent_id,
            sender_type=SenderType.AGENT,
            content="3 hits",
            metadata={"kind": "tool_result", "tool_name": "notes.search"},
        )
        label, body = _format_chat_entry(m, {}, agent_id)
        assert label == "TOOL"
        assert body.startswith("[Tool result: notes.search]")
