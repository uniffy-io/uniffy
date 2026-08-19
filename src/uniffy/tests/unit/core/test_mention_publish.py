"""Payload contract for ``publish_mention_state``."""

from unittest.mock import AsyncMock

from uniffy.core.json_codec import loads
from uniffy.core.types import generate_id
from uniffy.core.valkey import mentions, pubsub


async def _publish(monkeypatch) -> tuple[str, dict]:
    fake = AsyncMock()
    monkeypatch.setattr(pubsub, "_pubsub_client", fake)
    org = generate_id()
    urn = f"urn:uniffy:content:FOLDER:{generate_id()}"
    await mentions.publish_mention_state(org, urn, {"title": "T"})
    channel, message = fake.publish.await_args.args
    return channel, loads(message)


async def test_payload_contains_only_state_and_routing_fields(monkeypatch) -> None:
    channel, payload = await _publish(monkeypatch)
    assert channel.startswith("mentions:")
    assert payload["changes"] == {"title": "T"}
    assert "restricted" not in payload
