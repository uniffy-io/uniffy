"""Smoke test for the tag realtime publisher.

Mocks the pubsub client and verifies that ``publish_tag_event`` writes
to the right channel with a JSON-serialisable payload, and that an
unknown event type is rejected without touching Valkey.
"""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.types import generate_id
from uniffy.core.valkey import tags as tags_pubsub


def _run(coro):
    return asyncio.run(coro)


def test_publish_emits_to_org_channel() -> None:
    fake_client = MagicMock()
    fake_client.publish = AsyncMock(return_value=1)
    org_id = generate_id()

    with patch.object(tags_pubsub, "ops_call") as ctx:
        ctx.return_value.__aenter__ = AsyncMock(return_value=None)
        ctx.return_value.__aexit__ = AsyncMock(return_value=None)
        with patch("uniffy.core.valkey.pubsub._pubsub_client", fake_client):
            _run(
                tags_pubsub.publish_tag_event(
                    org_id,
                    tags_pubsub.EVENT_TAG_CREATED,
                    {"tag": {"id": str(generate_id()), "name": "docs"}},
                )
            )

    fake_client.publish.assert_awaited_once()
    channel, payload = fake_client.publish.await_args.args
    assert channel == f"tags:{org_id}"
    decoded = json.loads(payload)
    assert decoded["_type"] == tags_pubsub.EVENT_TAG_CREATED
    assert "tag" in decoded["payload"]


def test_publish_skips_unknown_event_type() -> None:
    fake_client = MagicMock()
    fake_client.publish = AsyncMock(return_value=1)

    with patch("uniffy.core.valkey.pubsub._pubsub_client", fake_client):
        _run(tags_pubsub.publish_tag_event(generate_id(), "tag.unknown", {}))

    fake_client.publish.assert_not_awaited()


def test_publish_no_op_when_pubsub_unavailable() -> None:
    with patch("uniffy.core.valkey.pubsub._pubsub_client", None):
        _run(
            tags_pubsub.publish_tag_event(
                generate_id(), tags_pubsub.EVENT_TAG_DELETED, {"tag_id": "x"}
            )
        )
