"""Phase 8 unit tests for chat-channel agent context management.

Covers the pure-logic edges around `ChannelAgentContextHandlers`:

- `_stats_to_proto` faithfully maps the dataclass into the proto wire
  shape, including the optional `manual_reset_at` timestamp.
- `_parse_ids` rejects malformed UUIDs with INVALID_ARGUMENT.

DB-backed integration coverage of `ChatAgentContextOperations.reset()` /
`get_stats()` / `compact()` is intentionally not in this suite (Phase 8g
will add a smoke + integration pass once the compactor lands in 8c).
"""

import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError

from uniffy.core.models.chat.message import SenderType
from uniffy.core.types import generate_id as uuid7
from uniffy.domains.agents.chat_integration.context import (
    ContextStats,
    _format_chat_entry,
)
from uniffy.domains.agents.chat_integration.context_handlers import (
    _parse_ids,
    _stats_to_proto,
)
from uniffy.domains.agents.runtime.compactor import (
    SummaryResult,
    format_conversation_lines,
    summarise_conversation,
)


def _run(coro):
    return asyncio.run(coro)


def _chat_msg(
    *,
    msg_id: UUID | None = None,
    sender_id: UUID,
    sender_type: SenderType = SenderType.USER,
    content: str = "",
    metadata: dict | None = None,
) -> SimpleNamespace:
    """Lightweight ChatMessage shim -- we only touch attribute access."""
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


