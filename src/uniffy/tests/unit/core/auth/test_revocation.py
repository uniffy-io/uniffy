import asyncio
import time
from unittest.mock import AsyncMock, MagicMock

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from fastapi import HTTPException
from starlette.requests import Request

from uniffy.core.auth import http, principal, revocation
from uniffy.core.realtime import reauth, ws_routes
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.realtime.state import WSSession
from uniffy.core.realtime.ydoc_manager import YDocManager
from uniffy.core.types import generate_id
from uniffy.domains.auth.interceptors import AuthenticationInterceptor
from uniffy.transport.rpc import code_for_domain_error


async def test_database_failure_cannot_become_an_allow(monkeypatch):
    monkeypatch.setattr(
        revocation, "open_session", MagicMock(side_effect=ConnectionError("database unavailable"))
    )
    with pytest.raises(revocation.RevocationUnavailableError) as outage:
        await revocation.token_revocation(generate_id(), 1, generate_id())
    # A caller that does not handle the outage still answers retryably, never internal.
    assert code_for_domain_error(outage.value) == Code.UNAVAILABLE


async def test_cancellation_is_not_swallowed(monkeypatch):
    monkeypatch.setattr(revocation, "open_session", MagicMock(side_effect=asyncio.CancelledError))
    with pytest.raises(asyncio.CancelledError):
        await revocation.token_revocation(generate_id(), 1, generate_id())


async def test_unavailable_database_denies_with_retryable_transport_errors(monkeypatch):
    user_id, org_id, sid = generate_id(), generate_id(), generate_id()
    payload = {
        "type": "access",
        "sub": str(user_id),
        "org_id": str(org_id),
        "sid": str(sid),
        "tkv": 1,
    }
    monkeypatch.setattr(
        revocation, "open_session", MagicMock(side_effect=ConnectionError("database unavailable"))
    )
    with pytest.raises(ConnectError) as rpc:
        await AuthenticationInterceptor._enforce_revocation(user_id, 1, sid)
    assert rpc.value.code == Code.UNAVAILABLE
    monkeypatch.setattr(http, "decode_access_token", lambda _: payload)
    with pytest.raises(HTTPException) as asset:
        await http.get_current_user_id(Request({"type": "http", "headers": []}), "Bearer token")
    assert asset.value.status_code == 503
    ws = AsyncMock()
    ws.headers = {"authorization": "Bearer token"}
    monkeypatch.setattr(ws_routes, "origin_is_allowed", lambda *_: True)
    monkeypatch.setattr(ws_routes, "decode_access_token", lambda _: payload)
    await ws_routes.serve_realtime(ws, org_id, YDocManager(buffer=UpdateBuffer()))
    ws.accept.assert_not_awaited()
    assert ws.close.await_args.kwargs["code"] == 1013
    assert user_id not in ws_routes._active_sockets
    live = WSSession(
        user_id=user_id,
        organization_id=org_id,
        token_version=1,
        session_id=sid,
        conn_id=1,
        ws=ws,
        expires_at=time.time() + 600,
    )
    denial = await reauth.connection_denial(live)
    assert denial is not None and denial.code == 1013


@pytest.mark.parametrize("sid", ["", "invalid", 42])
async def test_malformed_session_claim_cannot_become_sessionless(monkeypatch, sid):
    org_id = generate_id()
    payload = {
        "type": "access",
        "sub": str(generate_id()),
        "org_id": str(org_id),
        "sid": sid,
        "tkv": 1,
    }
    monkeypatch.setattr(principal, "decode_access_token", lambda _: payload)
    with pytest.raises(ConnectError):
        principal.principal_from_access_token("token")
    check = AsyncMock(return_value=None)
    monkeypatch.setattr(http, "decode_access_token", lambda _: payload)
    monkeypatch.setattr(http, "token_revocation", check)
    with pytest.raises(HTTPException) as asset:
        await http.get_current_user_id(Request({"type": "http", "headers": []}), "Bearer token")
    assert asset.value.status_code == 401
    ws = AsyncMock()
    ws.headers = {"authorization": "Bearer token"}
    monkeypatch.setattr(ws_routes, "origin_is_allowed", lambda *_: True)
    monkeypatch.setattr(ws_routes, "decode_access_token", lambda _: payload)
    monkeypatch.setattr(ws_routes, "token_revocation", check)
    await ws_routes.serve_realtime(ws, org_id, YDocManager(buffer=UpdateBuffer()))
    ws.accept.assert_not_awaited()
    check.assert_not_awaited()
