from datetime import UTC, datetime

from uniffy.core.json_codec import loads
from uniffy.core.types import generate_id
from uniffy.core.valkey import pubsub
from uniffy.domains.chat.streaming import events
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
    monkeypatch.setattr(pubsub, "_pubsub_client", publisher)
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
    assert event.message.created_at.ToDatetime(tzinfo=UTC) == created_at
    assert loads(event.message.metadata["nested"]) == {
        "sent_at": "2026-08-15T12:30:00+00:00"
    }
