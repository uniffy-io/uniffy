"""Bounded media checks without creating calls or publishing media."""

import asyncio
import os
import ssl
from contextlib import suppress
from dataclasses import dataclass
from enum import StrEnum
from urllib.parse import parse_qs, urlsplit
from uuid import UUID

from aioice import stun
from aioice.turn import TurnClientTcpProtocol, TurnClientUdpProtocol

from uniffy.domains.calls.config import LiveKitConfigError, get_turn_config
from uniffy.domains.calls.livekit import get_livekit_admin_client
from uniffy.domains.calls.turn import mint_turn_credentials

PROBE_TIMEOUT_SECONDS = 5
MAX_PROBE_URLS = 8


class ProbeTarget(StrEnum):
    LIVEKIT = "livekit"
    TURN_ALLOCATION = "turn_allocation"
    TURN_LISTENER = "turn_listener"


@dataclass(frozen=True)
class TurnEndpoint:
    host: str
    port: int
    transport: str
    tls: bool


def parse_turn_url(value: str) -> TurnEndpoint:
    scheme, separator, address = value.partition(":")
    if not separator or scheme not in ("turn", "turns"):
        raise LiveKitConfigError("TURN probe requires turn: or turns: URLs")
    parsed = urlsplit(f"{scheme}://{address.removeprefix('//')}")
    query = parse_qs(parsed.query, strict_parsing=True)
    tls = scheme == "turns"  # noqa: PLR2004
    transport = query.get("transport", ["tcp" if tls else "udp"])
    if (
        not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.path
        or parsed.fragment
        or set(query) - {"transport"}
        or len(transport) != 1
        or transport[0] not in ("tcp", "udp")
        or (tls and transport[0] != "tcp")  # noqa: PLR2004
    ):
        raise LiveKitConfigError("Invalid TURN probe URL")
    return TurnEndpoint(parsed.hostname, parsed.port or (5349 if tls else 3478), transport[0], tls)


async def probe_turn(endpoint: TurnEndpoint, username: str | None, password: str | None) -> None:
    loop = asyncio.get_running_loop()
    server = (endpoint.host, endpoint.port)
    arguments = dict(
        server=server, username=username, password=password, lifetime=30, channel_refresh_time=30
    )
    transport: asyncio.BaseTransport | None = None
    allocated = False
    protocol: TurnClientTcpProtocol | TurnClientUdpProtocol
    try:
        async with asyncio.timeout(PROBE_TIMEOUT_SECONDS):
            if endpoint.transport == "tcp":  # noqa: PLR2004
                transport, protocol = await loop.create_connection(
                    lambda: TurnClientTcpProtocol(**arguments),
                    host=endpoint.host,
                    port=endpoint.port,
                    ssl=ssl.create_default_context() if endpoint.tls else None,
                )
            else:
                transport, protocol = await loop.create_datagram_endpoint(
                    lambda: TurnClientUdpProtocol(**arguments),
                    remote_addr=server,
                )
            request = stun.Message(stun.Method.ALLOCATE, stun.Class.REQUEST)
            request.attributes["REQUESTED-TRANSPORT"] = 17 << 24
            request.attributes["LIFETIME"] = 30
            try:
                response, _ = await protocol.request_with_retry(request)
            except stun.TransactionFailed as exc:
                challenge = exc.response.attributes
                if (
                    username is None
                    and challenge.get("ERROR-CODE", (0,))[0] == 401
                    and challenge.get("REALM")
                    and challenge.get("NONCE")
                ):
                    return
                raise
            if "XOR-RELAYED-ADDRESS" not in response.attributes:  # noqa: PLR2004 - STUN attribute
                raise ValueError("TURN response has no relay address")
            allocated = True
    finally:
        if transport is not None:
            try:
                if allocated:
                    with suppress(TimeoutError, stun.TransactionError, OSError):
                        async with asyncio.timeout(1):
                            release = stun.Message(stun.Method.REFRESH, stun.Class.REQUEST)
                            release.attributes["LIFETIME"] = 0
                            await protocol.request_with_retry(release)
            finally:
                transport.close()


async def probe_media() -> int:
    if not any(
        os.getenv(name) for name in ("LIVEKIT_HOST", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET")
    ):
        return -1
    await get_livekit_admin_client().list_rooms(names=["uniffy-health-check"])
    return 1


async def probe_relay(*, allocation: bool) -> int:
    if allocation:
        config = get_turn_config()
        if config is None:
            return -1
        urls = config.server_urls
        # This identity is probe-only and never enters application state or logs.
        credentials = mint_turn_credentials(UUID(int=0), config)
        username, password = credentials.username, credentials.credential
    else:
        urls = tuple(
            value.strip()
            for value in os.getenv("CALLS_TURN_PROBE_URLS", "").split(",")
            if value.strip()
        )
        if not urls:
            return -1
        username, password = None, None
    if len(urls) > MAX_PROBE_URLS:
        raise LiveKitConfigError("Too many TURN probe URLs")
    endpoints = [parse_turn_url(url) for url in urls]
    results = await asyncio.gather(
        *(probe_turn(endpoint, username, password) for endpoint in endpoints), return_exceptions=True
    )
    for result in results:
        if isinstance(result, BaseException):
            raise result
    return 1
