"""Payload contract for ``publish_mention_state``."""

from unittest.mock import AsyncMock

from uniffy.core.content import mentions
from uniffy.core.types import generate_id


async def _publish(monkeypatch) -> tuple[str, dict]:
    fake = AsyncMock()
    monkeypatch.setattr(mentions, "publish_to_channel", fake)
    org = generate_id()
    urn = f"urn:uniffy:content:FOLDER:{generate_id()}"
    await mentions.publish_mention_state(org, urn, {"title": "T"})
    channel, payload = fake.await_args.args
    return channel, payload


async def test_payload_contains_only_state_and_routing_fields(monkeypatch) -> None:
    channel, payload = await _publish(monkeypatch)
    assert channel.startswith("mentions:")
    assert payload["changes"] == {"title": "T"}
    assert "restricted" not in payload
