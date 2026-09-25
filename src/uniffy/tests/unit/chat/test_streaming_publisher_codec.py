from datetime import UTC, datetime

from uniffy.core.converters.proto import timestamp_to_datetime
from uniffy.core.json_codec import loads
from uniffy.core.types import generate_id
from uniffy.domains.chat.streaming import events
from uniffy.domains.chat.streaming import publisher as publisher_module
from uniffy.domains.chat.streaming.handlers import _payload_to_channel_event
from uniffy.domains.chat.streaming.publisher import publish_user_chat_event


class _Publisher:
    def __init__(self) -> None:
        self.channel: str | None = None
        self.payload: bytes | None = None

    async def publish(self, channel: str, payload: bytes) -> None:
        self.channel = channel
        self.payload = payload


async def test_chat_datetime_payload_round_trips_through_handler(monkeypatch) -> None:
    publisher = _Publisher()
    monkeypatch.setattr(publisher_module, "publish_bytes", publisher.publish)
    user_id = generate_id()
    created_at = datetime(2026, 8, 15, 12, 30, tzinfo=UTC)

    await publish_user_chat_event(
        user_id,
        events.MESSAGE_CREATED,
        {
            "message_id": str(generate_id()),
            "channel_id": str(generate_id()),
            "sender_id": str(generate_id()),
            "sender_type": "USER",
            "content": "hello",
            "created_at": created_at,
            "metadata": {"nested": {"sent_at": created_at}},
        },
    )

    assert publisher.channel == f"chat:user:{user_id}"
    assert isinstance(publisher.payload, bytes)
    decoded = loads(publisher.payload)
    assert decoded["created_at"] == "2026-08-15T12:30:00+00:00"

    event = _payload_to_channel_event(decoded)
    assert event is not None
    assert timestamp_to_datetime(event.payload.value.created_at) == created_at
    assert loads(event.payload.value.metadata["nested"]) == {"sent_at": "2026-08-15T12:30:00+00:00"}


async def test_forward_context_round_trips_through_live_event(monkeypatch) -> None:
    publisher = _Publisher()
    monkeypatch.setattr(publisher_module, "publish_bytes", publisher.publish)
    user_id = generate_id()
    created_at = datetime(2026, 8, 22, 14, 30, tzinfo=UTC)
    source_message_id = generate_id()
    source_channel_id = generate_id()

    await publish_user_chat_event(
        user_id,
        events.MESSAGE_CREATED,
        {
            "message_id": str(generate_id()),
            "channel_id": str(generate_id()),
            "sender_id": str(generate_id()),
            "sender_type": "USER",
            "content": "Context",
            "created_at": created_at,
            "is_forwarded": True,
            "forward_context": {
                "message_id": str(source_message_id),
                "channel_id": str(source_channel_id),
                "channel_name": "strategy",
                "snapshot": {
                    "sender_id": str(generate_id()),
                    "sender_type": "USER",
                    "sender_name": "Alice Example",
                    "created_at": created_at,
                    "content": "Original",
                    "attachments": [],
                },
            },
        },
    )

    decoded = loads(publisher.payload)
    event = _payload_to_channel_event(decoded)

    assert event is not None
    assert event.payload.value.is_forwarded
    assert event.payload.value.has_field("forward_context")
    assert event.payload.value.forward_context.source_message_id == str(source_message_id)
    assert event.payload.value.forward_context.source_channel_id == str(source_channel_id)
    assert event.payload.value.forward_context.sender_name == "Alice Example"
    assert event.payload.value.forward_context.content == "Original"
    assert "forward" not in event.payload.value.metadata


async def test_restricted_forward_live_event_contains_no_snapshot(monkeypatch) -> None:
    publisher = _Publisher()
    monkeypatch.setattr(publisher_module, "publish_bytes", publisher.publish)

    await publish_user_chat_event(
        generate_id(),
        events.MESSAGE_CREATED,
        {
            "message_id": str(generate_id()),
            "channel_id": str(generate_id()),
            "sender_id": str(generate_id()),
            "sender_type": "USER",
            "content": "Context",
            "created_at": datetime(2026, 8, 22, 14, 30, tzinfo=UTC),
            "is_forwarded": True,
        },
    )

    decoded = loads(publisher.payload)
    event = _payload_to_channel_event(decoded)

    assert event is not None
    assert event.payload.value.is_forwarded
    assert not event.payload.value.has_field("forward_context")
    assert "forward" not in event.payload.value.metadata
