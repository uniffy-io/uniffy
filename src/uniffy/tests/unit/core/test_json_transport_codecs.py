from unittest.mock import AsyncMock

from uniffy.core.events.bus import _event_to_json, event_from_json
from uniffy.core.events.types import NotificationEvent
from uniffy.core.json_codec import loads
from uniffy.core.types import ContentType, NotificationType, generate_id
from uniffy.core.valkey import pubsub


async def test_pubsub_publishes_json_bytes(monkeypatch) -> None:
    publisher = AsyncMock()
    monkeypatch.setattr(pubsub, "_ensure_publisher", AsyncMock(return_value=publisher))
    content_id = generate_id()

    await pubsub.publish_to_channel("content:test", {"content_id": content_id})

    channel, payload = publisher.publish.await_args.args
    assert channel == "content:test"
    assert isinstance(payload, bytes)
    assert loads(payload) == {"content_id": str(content_id)}


def test_notification_event_codec_keeps_arq_argument_as_string() -> None:
    event = NotificationEvent(
        notification_type=NotificationType.CONTENT_MENTIONED,
        organization_id=generate_id(),
        actor_id=generate_id(),
        title="Mentioned",
        body="See the note",
        target_user_ids=[generate_id()],
        content_type=ContentType.NOTE,
        content_id=generate_id(),
        metadata={"source": "unit"},
    )

    encoded = _event_to_json(event)

    assert isinstance(encoded, str)
    assert event_from_json(encoded) == event
