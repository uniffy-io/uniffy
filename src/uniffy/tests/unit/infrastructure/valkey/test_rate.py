from unittest.mock import AsyncMock, MagicMock

from uniffy.infrastructure.valkey import rate


async def test_missing_ops_client_returns_unavailable(monkeypatch) -> None:
    monkeypatch.setattr(rate, "get_ops_client", lambda: None)

    assert await rate.increment_window("rl:test", 60) is None


async def test_first_increment_sets_expiry_and_returns_ttl(monkeypatch) -> None:
    client = MagicMock()
    client.incr = AsyncMock(return_value=1)
    client.expire = AsyncMock()
    client.ttl = AsyncMock(return_value=42)
    monkeypatch.setattr(rate, "get_ops_client", lambda: client)

    assert await rate.increment_window("rl:test", 60) == (1, 42)
    client.expire.assert_awaited_once_with("rl:test", 60)


async def test_transport_error_returns_unavailable(monkeypatch) -> None:
    client = MagicMock()
    client.incr = AsyncMock(side_effect=RuntimeError("unavailable"))
    monkeypatch.setattr(rate, "get_ops_client", lambda: client)

    assert await rate.increment_window("rl:test", 60) is None
