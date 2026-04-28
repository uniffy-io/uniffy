"""Round-trip tests for runtime stream event JSON serialisation.

The Valkey Streams transport (W2) uses JSON to encode every variant of
``RuntimeStreamEvent`` so workers and handlers can decode independently
of a shared in-memory dataclass instance. These tests pin the
symmetry of ``runtime_stream_event_to_json`` /
``runtime_stream_event_from_json`` for every variant.
"""

from datetime import UTC, datetime
from uuid import UUID

import pytest

from uniffy.core.models.agents.message import AgentMessage
from uniffy.core.types import generate_id as uuid7
from uniffy.domains.agents.runtime.converters import (
    runtime_stream_event_from_json,
    runtime_stream_event_to_json,
)
from uniffy.domains.agents.runtime.stream_events import (
    RuntimeConfirmationRequiredEvent,
    RuntimeDoneEvent,
    RuntimeErrorEvent,
    RuntimeMessageStoredEvent,
    RuntimeTokenEvent,
    RuntimeToolCallEvent,
    RuntimeToolResultEvent,
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
        token_estimate=3,
    )


class TestRuntimeStreamEventRoundTrip:
    def test_token_event_round_trip(self) -> None:
        msg_id = uuid7()
        event = RuntimeTokenEvent(text="hello", message_id=msg_id, sequence=7)
        decoded = runtime_stream_event_from_json(runtime_stream_event_to_json(event))
        assert isinstance(decoded, RuntimeTokenEvent)
        assert decoded.text == "hello"
        assert decoded.message_id == msg_id
        assert decoded.sequence == 7

    def test_token_event_without_message_round_trip(self) -> None:
        event = RuntimeTokenEvent(text="x", message_id=None, sequence=0)
        decoded = runtime_stream_event_from_json(runtime_stream_event_to_json(event))
        assert isinstance(decoded, RuntimeTokenEvent)
        assert decoded.message_id is None

    def test_tool_call_round_trip(self) -> None:
        event = RuntimeToolCallEvent(
            tool_call_id="tc_1",
            tool_name="notes.read_note",
            tool_args={"note_id": "abc"},
            message_id=uuid7(),
        )
        decoded = runtime_stream_event_from_json(runtime_stream_event_to_json(event))
        assert isinstance(decoded, RuntimeToolCallEvent)
        assert decoded.tool_call_id == "tc_1"
        assert decoded.tool_args == {"note_id": "abc"}

    def test_tool_result_round_trip(self) -> None:
        event = RuntimeToolResultEvent(
            tool_call_id="tc_1",
            tool_name="notes.read_note",
            success=False,
            result="not found",
            message_id=None,
        )
        decoded = runtime_stream_event_from_json(runtime_stream_event_to_json(event))
        assert isinstance(decoded, RuntimeToolResultEvent)
        assert decoded.success is False
        assert decoded.result == "not found"
        assert decoded.message_id is None

    def test_message_stored_round_trip(self) -> None:
        msg = _make_message()
        event = RuntimeMessageStoredEvent(message=msg)
        decoded = runtime_stream_event_from_json(runtime_stream_event_to_json(event))
        assert isinstance(decoded, RuntimeMessageStoredEvent)
        assert decoded.message.id == msg.id
        assert decoded.message.role == msg.role
        assert decoded.message.content == msg.content

    def test_done_round_trip(self) -> None:
        msg = _make_message()
        event = RuntimeDoneEvent(assistant_message=msg, model_used="claude-sonnet-4-6")
        decoded = runtime_stream_event_from_json(runtime_stream_event_to_json(event))
        assert isinstance(decoded, RuntimeDoneEvent)
        assert decoded.assistant_message.id == msg.id
        assert decoded.model_used == "claude-sonnet-4-6"

    def test_confirmation_required_round_trip(self) -> None:
        request_id = uuid7()
        event = RuntimeConfirmationRequiredEvent(
            tool_call_id="tc_2",
            tool_name="notes.delete_note",
            tool_args={"note_id": "abc"},
            description="Permanent delete",
            request_id=request_id,
            message_id=None,
        )
        decoded = runtime_stream_event_from_json(runtime_stream_event_to_json(event))
        assert isinstance(decoded, RuntimeConfirmationRequiredEvent)
        assert decoded.request_id == request_id
        assert decoded.message_id is None

    def test_error_round_trip(self) -> None:
        event = RuntimeErrorEvent(error="boom")
        decoded = runtime_stream_event_from_json(runtime_stream_event_to_json(event))
        assert isinstance(decoded, RuntimeErrorEvent)
        assert decoded.error == "boom"

    def test_unknown_type_raises(self) -> None:
        with pytest.raises(ValueError):
            runtime_stream_event_from_json({"type": "no_such_event"})

    def test_token_message_id_preserves_uuid(self) -> None:
        msg_id = UUID("00000000-0000-0000-0000-000000000001")
        event = RuntimeTokenEvent(text="x", message_id=msg_id, sequence=1)
        encoded = runtime_stream_event_to_json(event)
        assert isinstance(encoded["message_id"], str)
        decoded = runtime_stream_event_from_json(encoded)
        assert decoded.message_id == msg_id
