"""Upgrade refusals reach a real WebSocket client, through Granian, as their documented close codes."""

import asyncio
import socket
from collections.abc import AsyncIterator, Callable
from types import SimpleNamespace
from urllib.parse import quote

import aiohttp
import pytest
import pytest_asyncio
from fastapi import FastAPI
from granian.constants import Interfaces
from granian.server.embed import Server

from uniffy.core.auth.tokens import create_access_token
from uniffy.core.realtime.auth import (
    CANONICAL_SUBPROTOCOL,
    WS_CLOSE_FORBIDDEN,
    WS_CLOSE_TOKEN_REVOKED,
    WS_CLOSE_UNAUTHENTICATED,
)
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.realtime.ws_routes import create_realtime_router
from uniffy.core.realtime.ydoc_manager import YDocManager
from uniffy.core.types import generate_id

pytestmark = pytest.mark.asyncio(loop_scope="session")

ALLOWED_ORIGIN = "https://app.uniffy.test"


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


@pytest_asyncio.fixture(loop_scope="session")
async def realtime_url(database, monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[str]:
    """The realtime route served by Granian on a local port, in this test's loop."""
    monkeypatch.setenv("CORS_ORIGINS", ALLOWED_ORIGIN)
    app = FastAPI()
    buffer = UpdateBuffer(namespace=f"test:{generate_id().hex}:")
    app.include_router(create_realtime_router(YDocManager(buffer=buffer)))
    port = _free_port()
    server = Server(app, port=port, interface=Interfaces.ASGINL, log_enabled=False)
    serving = asyncio.create_task(server.serve())
    async with asyncio.timeout(10):
        while True:
            try:
                _, writer = await asyncio.open_connection("127.0.0.1", port)
            except OSError:
                await asyncio.sleep(0.05)
                continue
            writer.close()
            await writer.wait_closed()
            break
    try:
        yield f"http://127.0.0.1:{port}/realtime"
    finally:
        server.stop()
        await serving


def offer(token: str) -> tuple[str, str]:
    """The web client's offer: the canonical protocol and the bearer entry."""
    return CANONICAL_SUBPROTOCOL, f"bearer.{quote(token)}"


REFUSALS: dict[str, tuple[Callable[[SimpleNamespace], tuple[str, str, str]], int, str]] = {
    # (token, url organization, origin) for each refusal, and the close that must arrive.
    "invalid_token": (
        lambda a: ("not-a-token", str(a.org_id), ALLOWED_ORIGIN),
        WS_CLOSE_UNAUTHENTICATED,
        "invalid token",
    ),
    "forbidden_origin": (
        lambda a: (
            create_access_token(a.member_id, a.org_id, token_version=1),
            str(a.org_id),
            "https://elsewhere.test",
        ),
        WS_CLOSE_FORBIDDEN,
        "origin not allowed",
    ),
    "other_organization": (
        lambda a: (
            create_access_token(a.member_id, a.org_id, token_version=1),
            str(a.other_org_id),
            ALLOWED_ORIGIN,
        ),
        WS_CLOSE_FORBIDDEN,
        "org mismatch",
    ),
    "non_member": (
        lambda a: (
            create_access_token(a.outsider_id, a.org_id, token_version=1),
            str(a.org_id),
            ALLOWED_ORIGIN,
        ),
        WS_CLOSE_FORBIDDEN,
        "not a member",
    ),
    "revoked": (
        # The account is at token version 1, so a version 2 token was revoked by a later change.
        lambda a: (
            create_access_token(a.member_id, a.org_id, token_version=2),
            str(a.org_id),
            ALLOWED_ORIGIN,
        ),
        WS_CLOSE_TOKEN_REVOKED,
        "credentials revoked",
    ),
}


@pytest.mark.parametrize("refusal", list(REFUSALS))
async def test_refused_upgrade_reaches_the_client_as_its_close_code(
    access: SimpleNamespace, realtime_url: str, refusal: str
) -> None:
    upgrade, code, reason = REFUSALS[refusal]
    token, organization, origin = upgrade(access)

    async with (
        aiohttp.ClientSession() as http,
        http.ws_connect(
            realtime_url,
            params={"org_id": organization},
            protocols=offer(token),
            origin=origin,
        ) as ws,
    ):
        message = await asyncio.wait_for(ws.receive(), 5)
        selected = ws.protocol

    assert message.type is aiohttp.WSMsgType.CLOSE
    assert (message.data, message.extra) == (code, reason)
    # The handshake never echoes the bearer entry.
    assert selected == CANONICAL_SUBPROTOCOL


async def test_member_upgrade_opens_a_session_on_the_canonical_protocol(
    access: SimpleNamespace, realtime_url: str
) -> None:
    token = create_access_token(access.member_id, access.org_id, token_version=1)

    async with (
        aiohttp.ClientSession() as http,
        http.ws_connect(
            realtime_url,
            params={"org_id": str(access.org_id)},
            protocols=offer(token),
            origin=ALLOWED_ORIGIN,
        ) as ws,
    ):
        assert ws.protocol == CANONICAL_SUBPROTOCOL
        assert not ws.closed


async def test_upgrade_without_a_token_is_refused_before_the_handshake(
    access: SimpleNamespace, realtime_url: str
) -> None:
    async with aiohttp.ClientSession() as http:
        with pytest.raises(aiohttp.WSServerHandshakeError) as refused:
            await http.ws_connect(
                realtime_url,
                params={"org_id": str(access.org_id)},
                protocols=(CANONICAL_SUBPROTOCOL,),
                origin=ALLOWED_ORIGIN,
            )

    assert refused.value.status == 403


@pytest.mark.parametrize("params", [{}, {"org_id": "not-a-uuid"}], ids=["missing", "malformed"])
async def test_upgrade_without_a_valid_organization_is_refused_before_the_handshake(
    access: SimpleNamespace, realtime_url: str, params: dict[str, str]
) -> None:
    token = create_access_token(access.member_id, access.org_id, token_version=1)

    async with aiohttp.ClientSession() as http:
        with pytest.raises(aiohttp.WSServerHandshakeError) as refused:
            await http.ws_connect(
                realtime_url, params=params, protocols=offer(token), origin=ALLOWED_ORIGIN
            )

    assert refused.value.status == 403
