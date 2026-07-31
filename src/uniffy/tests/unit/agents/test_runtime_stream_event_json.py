"""Round-trip tests for runtime stream event JSON serialisation.

The Valkey Streams transport uses a sparse JSON envelope (``type`` +
non-default fields) to encode every ``StreamEvent`` variant so workers
and handlers can decode independently of a shared in-memory instance.
These tests pin the symmetry of ``runtime_stream_event_to_json`` /
``runtime_stream_event_from_json``.
"""

from datetime import UTC, datetime
from uuid import UUID

import pytest

from uniffy.core.models.agents.message import AgentMessage
from uniffy.core.types import generate_id as uuid7
from uniffy.domains.agents.providers.base import EventType, StreamEvent
from uniffy.domains.agents.runtime.converters import (
    runtime_stream_event_from_json,
    runtime_stream_event_to_json,
)


def _make_message(role: str = "assistant") -> AgentMessage:
    return AgentMessage(
        id=uuid7(),
        session_id=uuid7(),
        role=role,
        content="hello",
        input_tokens=1,
        output_tokens=2,
        model="claude-sonnet-4-6",
        created_at=datetime.now(UTC),
    )


def _round_trip(event: StreamEvent) -> StreamEvent:
    return runtime_stream_event_from_json(runtime_stream_event_to_json(event))


class TestRuntimeStreamEventRoundTrip:
    def test_text_delta_round_trip(self) -> None:
        msg_id = uuid7()
        decoded = _round_trip(
            StreamEvent(
                type=EventType.TEXT_BLOCK_DELTA,
                block_id="b1",
                delta="hello",
                message_id=msg_id,
                sequence=7,
            )
        )
        assert decoded.type is EventType.TEXT_BLOCK_DELTA
        assert decoded.block_id == "b1"
        assert decoded.delta == "hello"
        assert decoded.message_id == msg_id
        assert decoded.sequence == 7

    def test_text_delta_without_message_round_trip(self) -> None:
        decoded = _round_trip(
            StreamEvent(type=EventType.TEXT_BLOCK_DELTA, block_id="b1", delta="x")
        )
        assert decoded.message_id is None
        assert decoded.sequence == 0

    def test_thinking_end_round_trip(self) -> None:
        decoded = _round_trip(
            StreamEvent(
                type=EventType.THINKING_BLOCK_END,
                block_id="t1",
                signature="sig-abc",
                elapsed_ms=3200,
            )
        )
        assert decoded.type is EventType.THINKING_BLOCK_END
        assert decoded.signature == "sig-abc"
        assert decoded.elapsed_ms == 3200

    def test_tool_call_end_round_trip(self) -> None:
        decoded = _round_trip(
            StreamEvent(
                type=EventType.TOOL_CALL_END,
                block_id="c1",
                tool_call_id="tc_1",
                tool_name="notes.read_note",
                tool_args={"note_id": "abc"},
            )
        )
        assert decoded.tool_call_id == "tc_1"
        assert decoded.tool_args == {"note_id": "abc"}

    def test_tool_result_start_round_trip(self) -> None:
        decoded = _round_trip(
            StreamEvent(
                type=EventType.TOOL_RESULT_START,
                tool_call_id="tc_1",
                tool_name="notes.read_note",
                tool_args={"note_id": "abc"},
                message_id=uuid7(),
            )
        )
        assert decoded.type is EventType.TOOL_RESULT_START
        assert decoded.tool_args == {"note_id": "abc"}

    def test_tool_result_end_failure_round_trip(self) -> None:
        decoded = _round_trip(
            StreamEvent(
                type=EventType.TOOL_RESULT_END,
                tool_call_id="tc_1",
                tool_name="notes.read_note",
                success=False,
                tool_result="not found",
            )
        )
        assert decoded.success is False
        assert decoded.tool_result == "not found"
        assert decoded.message_id is None

    def test_model_call_end_round_trip(self) -> None:
        decoded = _round_trip(
            StreamEvent(
                type=EventType.MODEL_CALL_END,
                model="claude-sonnet-4-6",
                input_tokens=10,
                output_tokens=5,
                cache_read_input_tokens=3,
            )
        )
        assert decoded.model == "claude-sonnet-4-6"
        assert decoded.input_tokens == 10
        assert decoded.cache_read_input_tokens == 3

    def test_message_stored_round_trip(self) -> None:
        msg = _make_message()
        decoded = _round_trip(
            StreamEvent(type=EventType.MESSAGE_STORED, message=msg)
        )
        assert decoded.message.id == msg.id
        assert decoded.message.role == msg.role
        assert decoded.message.content == msg.content

    def test_done_round_trip(self) -> None:
        msg = _make_message()
        decoded = _round_trip(
            StreamEvent(
                type=EventType.DONE,
                assistant_message=msg,
                model="claude-sonnet-4-6",
            )
        )
        assert decoded.type is EventType.DONE
        assert decoded.assistant_message.id == msg.id
        assert decoded.model == "claude-sonnet-4-6"

    def test_confirmation_required_round_trip(self) -> None:
        request_id = uuid7()
        decoded = _round_trip(
            StreamEvent(
                type=EventType.CONFIRMATION_REQUIRED,
                tool_call_id="tc_2",
                tool_name="notes.delete_note",
                tool_args={"note_id": "abc"},
                description="Permanent delete",
                request_id=request_id,
            )
        )
        assert decoded.request_id == request_id
        assert decoded.message_id is None

    def test_failover_round_trip(self) -> None:
        decoded = _round_trip(
            StreamEvent(
                type=EventType.FAILOVER,
                from_provider_key_id="k1",
                to_provider_key_id="k2",
                to_model="gpt-5",
                reason="timeout",
                attempt=2,
            )
        )
        assert decoded.to_provider_key_id == "k2"
        assert decoded.reason == "timeout"
        assert decoded.attempt == 2

    def test_error_round_trip(self) -> None:
        decoded = _round_trip(StreamEvent(type=EventType.ERROR, error="boom"))
        assert decoded.type is EventType.ERROR
        assert decoded.error == "boom"

    def test_skill_draft_round_trip(self) -> None:
        from uniffy.core.models.agents.skill_draft import AgentSkillDraft

        draft = AgentSkillDraft(
            id=uuid7(),
            organization_id=uuid7(),
            owner_id=uuid7(),
            kind="create",
            name="weekly-report",
            display_name="Weekly Report",
            content="Steps to write the report",
            status="pending",
        )
        decoded = _round_trip(StreamEvent(type=EventType.SKILL_DRAFT, draft=draft))
        assert decoded.draft.id == draft.id
        assert decoded.draft.name == "weekly-report"
        assert decoded.draft.kind == "create"

    def test_completion_result_never_serialized(self) -> None:
        from uniffy.domains.agents.providers.base import CompletionResult

        encoded = runtime_stream_event_to_json(
            StreamEvent(
                type=EventType.MODEL_CALL_END,
                model="m",
                result=CompletionResult(content="x", model="m"),
            )
        )
        assert "result" not in encoded

    def test_unknown_type_raises(self) -> None:
        with pytest.raises(ValueError):
            runtime_stream_event_from_json({"type": "no_such_event"})

    def test_unknown_field_raises(self) -> None:
        with pytest.raises(ValueError):
            runtime_stream_event_from_json(
                {"type": "text_block_delta", "bogus": 1}
            )

    def test_message_id_preserves_uuid(self) -> None:
        msg_id = UUID("00000000-0000-0000-0000-000000000001")
        encoded = runtime_stream_event_to_json(
            StreamEvent(
                type=EventType.TEXT_BLOCK_DELTA,
                delta="x",
                message_id=msg_id,
                sequence=1,
            )
        )
        assert isinstance(encoded["message_id"], str)
        decoded = runtime_stream_event_from_json(encoded)
        assert decoded.message_id == msg_id
