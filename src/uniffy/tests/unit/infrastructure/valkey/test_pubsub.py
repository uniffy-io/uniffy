from contextlib import aclosing
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.infrastructure.valkey import pubsub as transport


@pytest.mark.parametrize("notify", [True, False])
async def test_subscribe_acknowledgement_is_opt_in(
    monkeypatch: pytest.MonkeyPatch, notify: bool
) -> None:
    pubsub = SimpleNamespace(
        subscribe=AsyncMock(),
        unsubscribe=AsyncMock(),
        aclose=AsyncMock(),
        get_message=AsyncMock(
            side_effect=[
                {"type": "subscribe", "data": 1},
                {"type": "message", "data": '{"content":"event"}'},
                {"type": "subscribe", "data": 1},
                {"type": "message", "data": '{"content":"after reconnect"}'},
            ]
        ),
    )
    client = SimpleNamespace(pubsub=MagicMock(return_value=pubsub), aclose=AsyncMock())
    monkeypatch.setattr(transport, "_build_client", lambda _url: client)
    monkeypatch.setattr(transport, "_shutdown_event", None)
    async with aclosing(
        transport.subscribe_channels("test:channel", notify_subscriptions=notify)
    ) as stream:
        if notify:
            assert await anext(stream) == {"_subscription_ready": True}
        assert await anext(stream) == {"content": "event"}
        if notify:
            assert await anext(stream) == {"_subscription_ready": True}
        assert await anext(stream) == {"content": "after reconnect"}
    pubsub.unsubscribe.assert_awaited_once_with("test:channel")
    pubsub.aclose.assert_awaited_once()
    client.aclose.assert_awaited_once()
