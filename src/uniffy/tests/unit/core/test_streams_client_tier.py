"""Pin ``stream_xread`` onto the streams client tier.

The original implementation used the fail-fast ops client whose 100ms
socket timeout aborts XREAD's inner BLOCK on every call, causing a
log-spam loop and effective polling at ~10Hz instead of blocking. The
streams tier owns its own connection pool with a 30s socket timeout so
the BLOCK actually blocks. These tests fail loudly if anyone wires
``stream_xread`` back onto the ops client.

The non-blocking helpers (XADD, HSET, DEL) stay on the ops client and
inherit the 150ms ``ops_call`` deadline guard.
"""

from __future__ import annotations

from typing import Any

import pytest

from uniffy.core.valkey import streams as streams_mod


class _FakeStreamsClient:
    def __init__(self, result: list[Any] | None = None) -> None:
        self.result = result or []
        self.xread_calls: list[dict[str, Any]] = []

    async def xread(
        self,
        streams: dict[str, str],
        count: int,
        block: int,
    ) -> list[Any]:
        self.xread_calls.append({"streams": streams, "count": count, "block": block})
        return self.result


class _FakeOpsClient:
    def __init__(self) -> None:
        self.xread_calls: list[Any] = []

    async def xread(self, *_args: Any, **_kwargs: Any) -> list[Any]:
        self.xread_calls.append(_kwargs)
        return []


async def test_stream_xread_uses_streams_client_not_ops_client(monkeypatch) -> None:
    streams_client = _FakeStreamsClient(result=[])
    ops_client = _FakeOpsClient()

    monkeypatch.setattr(streams_mod, "_get_streams_client", lambda: streams_client)
    monkeypatch.setattr(streams_mod, "_get_ops_client", lambda: ops_client)

    await streams_mod.stream_xread("agent:run:test", last_id="0", block_ms=5000)

    assert len(streams_client.xread_calls) == 1, (
        "stream_xread MUST go through the streams client. "
        "If this fails, someone wired XREAD back onto the ops client whose "
        "100ms socket_timeout aborts the inner BLOCK."
    )
    assert ops_client.xread_calls == []


async def test_stream_xread_returns_empty_when_streams_client_missing(monkeypatch) -> None:
    monkeypatch.setattr(streams_mod, "_get_streams_client", lambda: None)
    result = await streams_mod.stream_xread("agent:run:test")
    assert result == []


async def test_stream_xread_swallows_redis_timeout(monkeypatch, caplog) -> None:
    from valkey.exceptions import TimeoutError as ValkeyTimeoutError

    class _BoomClient:
        async def xread(self, **_kwargs: Any) -> list[Any]:
            raise ValkeyTimeoutError("simulated block deadline")

    monkeypatch.setattr(streams_mod, "_get_streams_client", lambda: _BoomClient())

    with caplog.at_level("WARNING"):
        result = await streams_mod.stream_xread("agent:run:test")

    assert result == []
    warnings = [r for r in caplog.records if r.levelname == "WARNING"]
    assert warnings == [], (
        "ValkeyTimeoutError must NOT log at WARNING -- it's expected when a "
        "block elapses with no events. Was logged: "
        f"{[r.message for r in warnings]}"
    )


def test_streams_kwargs_have_long_socket_timeout() -> None:
    """The streams tier's reason for existing: a long enough socket timeout
    that XREAD's inner BLOCK can actually wait."""
    from uniffy.core.valkey.config import ValkeyConfig

    cfg = ValkeyConfig(host="x", port=1, password="y")
    kwargs = cfg.to_streams_kwargs()
    assert kwargs["socket_timeout"] >= 10.0, (
        "Streams socket_timeout must comfortably exceed the longest XREAD "
        f"block_ms a caller passes. Currently {kwargs['socket_timeout']}s."
    )
    assert kwargs["retry_on_timeout"] is False
    assert kwargs["retry_on_error"] == []


@pytest.mark.parametrize(
    "func_name",
    ["stream_xadd", "stream_set_state", "stream_get_state", "stream_delete"],
)
async def test_non_blocking_helpers_still_use_ops_client(monkeypatch, func_name: str) -> None:
    """The non-blocking writes / reads stay on the ops client tier."""
    ops_used = {"called": False}

    class _OpsClient:
        async def xadd(self, *_a: Any, **_k: Any) -> str:
            ops_used["called"] = True
            return "1-0"

        def pipeline(self, *_a: Any, **_k: Any) -> _OpsClient:
            ops_used["called"] = True
            return self

        def hset(self, *_a: Any, **_k: Any) -> None:
            pass

        def expire(self, *_a: Any, **_k: Any) -> None:
            pass

        async def execute(self) -> None:
            return None

        async def hgetall(self, *_a: Any, **_k: Any) -> dict[str, str]:
            ops_used["called"] = True
            return {}

        async def delete(self, *_a: Any, **_k: Any) -> int:
            ops_used["called"] = True
            return 1

    streams_blew_up = {"called": False}

    class _StreamsClient:
        async def xadd(self, *_a: Any, **_k: Any) -> str:
            streams_blew_up["called"] = True
            return "1-0"

        def pipeline(self, *_a: Any, **_k: Any) -> _StreamsClient:
            streams_blew_up["called"] = True
            return self

        async def hgetall(self, *_a: Any, **_k: Any) -> dict[str, str]:
            streams_blew_up["called"] = True
            return {}

        async def delete(self, *_a: Any, **_k: Any) -> int:
            streams_blew_up["called"] = True
            return 1

    monkeypatch.setattr(streams_mod, "_get_ops_client", lambda: _OpsClient())
    monkeypatch.setattr(streams_mod, "_get_streams_client", lambda: _StreamsClient())

    func = getattr(streams_mod, func_name)
    if func_name == "stream_xadd":
        await func("agent:run:test", {"seq": 1})
    elif func_name == "stream_set_state":
        await func("agent:run:test:state", {"status": "running"})
    elif func_name == "stream_get_state":
        await func("agent:run:test:state")
    elif func_name == "stream_delete":
        await func("agent:run:test", "agent:run:test:state")

    assert ops_used["called"] is True, f"{func_name} must use the ops client"
    assert streams_blew_up["called"] is False, (
        f"{func_name} must NOT use the streams client; that tier is reserved for blocking XREAD."
    )
