"""Payload contract for ``publish_mention_state``."""

import json
from unittest.mock import AsyncMock

from uniffy.core.types import generate_id
from uniffy.core.valkey import mentions, pubsub


async def _publish(monkeypatch, **kwargs) -> tuple[str, dict]:
    fake = AsyncMock()
    monkeypatch.setattr(pubsub, "_pubsub_client", fake)
    org = generate_id()
    urn = f"urn:uniffy:content:FOLDER:{generate_id()}"
    await mentions.publish_mention_state(org, urn, {"title": "T"}, **kwargs)
    channel, message = fake.publish.await_args.args
    return channel, json.loads(message)


async def test_restricted_flag_rides_the_payload(monkeypatch) -> None:
    channel, payload = await _publish(monkeypatch, restricted=True)
    assert channel.startswith("mentions:")
    assert payload["restricted"] is True
    assert payload["changes"] == {"title": "T"}


async def test_default_payload_carries_no_restricted_key(monkeypatch) -> None:
    _, payload = await _publish(monkeypatch)
    assert "restricted" not in payload
