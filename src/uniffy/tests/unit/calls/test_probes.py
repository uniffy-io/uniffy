import asyncio
from unittest.mock import AsyncMock

import pytest
from aioice import stun
from aioice.turn import make_integrity_key

from uniffy.domains.calls import probes
from uniffy.domains.calls.config import LiveKitConfigError, TurnConfig
from uniffy.domains.calls.jobs import monitoring
from uniffy.domains.calls.metrics import PROBE_TIME, PROBE_UP, SNAPSHOT_TIME
from uniffy.domains.calls.probes import ProbeTarget, TurnEndpoint, parse_turn_url, probe_turn


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("turn:relay:3478?transport=udp", TurnEndpoint("relay", 3478, "udp", False)),
        ("turn:[::1]:3479?transport=tcp", TurnEndpoint("::1", 3479, "tcp", False)),
        ("turns:relay", TurnEndpoint("relay", 5349, "tcp", True)),
    ],
)
def test_turn_urls(url, expected):
    assert parse_turn_url(url) == expected


@pytest.mark.parametrize(
    "url",
    [
        "https://relay",
        "turn:",
        "turns:relay?transport=udp",
        "turn:relay?transport=tcp&transport=udp",
        "turn:user:pass@relay",
        "turn:relay/path",
        "turn:relay?secret=x",
    ],
)
def test_invalid_turn_urls(url):
    with pytest.raises(LiveKitConfigError):
        parse_turn_url(url)


class Relay(asyncio.DatagramProtocol):
    def __init__(self, *, silent=False):
        self.silent = silent
        self.requests = []
        self.integrity_key = make_integrity_key("probe", "test", "correct")

    def connection_made(self, transport):
        self.transport = transport

    def datagram_received(self, data, addr):
        if self.silent:
            return
        request = stun.parse_message(data)
        self.requests.append(request)
        authenticated = False
        if "MESSAGE-INTEGRITY" in request.attributes:
            try:
                stun.parse_message(data, integrity_key=self.integrity_key)
                authenticated = True
            except ValueError:
                pass
        response = stun.Message(
            request.message_method,
            stun.Class.RESPONSE if authenticated else stun.Class.ERROR,
            transaction_id=request.transaction_id,
        )
        if not authenticated:
            response.attributes.update({
                "ERROR-CODE": (401, "Unauthorized"),
                "REALM": "test",
                "NONCE": b"nonce",
            })
        elif request.message_method == stun.Method.ALLOCATE:
            response.attributes.update({"XOR-RELAYED-ADDRESS": ("127.0.0.1", 45678), "LIFETIME": 30})
        else:
            response.attributes["LIFETIME"] = 0
        self.transport.sendto(bytes(response), addr)


@pytest.fixture
async def relay():
    transport, protocol = await asyncio.get_running_loop().create_datagram_endpoint(
        Relay, local_addr=("127.0.0.1", 0)
    )
    try:
        yield (
            protocol,
            TurnEndpoint("127.0.0.1", transport.get_extra_info("sockname")[1], "udp", False),
        )
    finally:
        transport.close()


async def test_turn_allocation_authenticates_and_releases(relay):
    server, endpoint = relay
    await probe_turn(endpoint, "probe", "correct")
    assert [request.message_method for request in server.requests] == [
        stun.Method.ALLOCATE,
        stun.Method.ALLOCATE,
        stun.Method.REFRESH,
    ]
    assert server.requests[-1].attributes["LIFETIME"] == 0


async def test_turn_wrong_credentials_fail_but_listener_challenge_passes(relay):
    _, endpoint = relay
    with pytest.raises(stun.TransactionFailed):
        await probe_turn(endpoint, "probe", "wrong")
    await probe_turn(endpoint, None, None)


@pytest.mark.parametrize("cancel", [False, True])
async def test_unreachable_turn_timeout_and_cancellation_close_socket(relay, monkeypatch, cancel):
    server, endpoint = relay
    server.silent = True
    loop = asyncio.get_running_loop()
    create = loop.create_datagram_endpoint
    sockets = []

    async def capture(*args, **kwargs):
        result = await create(*args, **kwargs)
        sockets.append(result[0])
        return result

    monkeypatch.setattr(loop, "create_datagram_endpoint", capture)
    monkeypatch.setattr(probes, "PROBE_TIMEOUT_SECONDS", 0.02)
    task = asyncio.create_task(probe_turn(endpoint, "probe", "correct"))
    if cancel:
        while not sockets:
            await asyncio.sleep(0)
        await asyncio.sleep(0)
        task.cancel()
    with pytest.raises(asyncio.CancelledError if cancel else TimeoutError):
        await task
    assert sockets and all(socket.is_closing() for socket in sockets)


async def test_every_configured_relay_must_pass(monkeypatch):
    monkeypatch.setattr(
        probes, "get_turn_config", lambda: TurnConfig(("turn:one", "turn:two"), "secret", 60)
    )
    probe = AsyncMock(side_effect=[None, OSError("unreachable")])
    monkeypatch.setattr(probes, "probe_turn", probe)
    with pytest.raises(OSError):
        await probes.probe_relay(allocation=True)
    assert probe.await_count == 2


async def test_unconfigured_relay_is_not_reported_healthy(monkeypatch):
    monkeypatch.setattr(probes, "get_turn_config", lambda: None)
    monkeypatch.delenv("CALLS_TURN_PROBE_URLS", raising=False)
    assert await probes.probe_relay(allocation=True) == -1
    assert await probes.probe_relay(allocation=False) == -1


async def test_monitoring_failure_preserves_snapshot_age_and_updates_probe_failure(monkeypatch):
    timestamp = SNAPSHOT_TIME._value.get()
    monkeypatch.setattr(monitoring, "_snapshot", AsyncMock(side_effect=OSError("database down")))
    monkeypatch.setattr(monitoring, "probe_media", AsyncMock(side_effect=TimeoutError()))
    monkeypatch.setattr(monitoring, "probe_relay", AsyncMock(return_value=-1))
    result = await monitoring.monitor_calls({})
    assert result == {"livekit": 0, "turn_allocation": -1, "turn_listener": -1}
    assert SNAPSHOT_TIME._value.get() == timestamp
    assert PROBE_UP.labels(ProbeTarget.LIVEKIT)._value.get() == 0
    assert PROBE_TIME.labels(ProbeTarget.LIVEKIT)._value.get() > 0
