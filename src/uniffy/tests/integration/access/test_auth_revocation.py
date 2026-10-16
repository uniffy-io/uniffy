import asyncio
import time
from collections.abc import AsyncIterator
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pycrdt
import pytest
import pytest_asyncio
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.method import IdempotencyLevel, MethodInfo
from connectrpc.request import Headers, RequestContext
from fastapi import HTTPException
from sqlalchemy import delete, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from uniffy.core.auth import revocation
from uniffy.core.auth.cookies import resolve_asset_cookie_config
from uniffy.core.auth.http import get_current_user_id
from uniffy.core.auth.tokens import create_access_token, create_asset_read_token
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.login.user import User
from uniffy.core.models.login.user_session import UserSession
from uniffy.core.realtime import session as realtime_session
from uniffy.core.realtime import ws_routes
from uniffy.core.realtime.auth import (
    CANONICAL_SUBPROTOCOL,
    WS_CLOSE_TOKEN_REVOKED,
    WS_CLOSE_UNAUTHENTICATED,
)
from uniffy.core.realtime.multiplex import encode_doc_frame
from uniffy.core.realtime.reauth import connection_denial
from uniffy.core.realtime.state import WSSession, doc_name_for
from uniffy.core.realtime.wire import create_sync_message
from uniffy.core.types import ContentType, generate_id
from uniffy.domains.auth.interceptors import AuthenticationInterceptor
from uniffy.domains.auth.operations import AuthOperations
from uniffy.tests.integration.access.test_realtime_live_routing import Socket

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest_asyncio.fixture(loop_scope="session")
async def login(
    session: AsyncSession, access: SimpleNamespace, monkeypatch
) -> AsyncIterator[UserSession]:
    monkeypatch.setenv("JWT_SECRET_KEY", "durable-revocation-test-secret-at-least-32-bytes")
    row = UserSession(user_id=access.member_id, organization_id=access.org_id)
    session.add(row)
    await session.commit()
    try:
        yield row
    finally:
        await session.rollback()
        await session.execute(delete(UserSession).where(UserSession.user_id.in_(access.user_ids)))
        await session.execute(text("SET LOCAL uniffy.audit_maintenance = 'on'"))
        await session.execute(
            delete(AuditEvent).where(AuditEvent.actor_user_id.in_(access.user_ids))
        )
        await session.commit()


def rpc_context(bearer: str) -> RequestContext:
    return RequestContext(
        method=MethodInfo(
            name="ListNotes",
            service_name="notes.v1.NotesService",
            input=object,
            output=object,
            idempotency_level=IdempotencyLevel.UNKNOWN,
        ),
        http_method="POST",
        request_headers=Headers({"authorization": f"Bearer {bearer}"}),
    )


def asset_request(cookie: str | None = None) -> Request:
    return Request({"type": "http", "headers": [(b"cookie", cookie.encode())] if cookie else []})


@pytest.mark.parametrize("cache_state", ["missing", "unavailable", "empty"])
async def test_committed_logout_rejects_old_credentials_without_cache(
    session: AsyncSession, access: SimpleNamespace, login: UserSession, monkeypatch, cache_state: str
) -> None:
    cache = AsyncMock()
    cache.get.return_value = None
    if cache_state == "unavailable":
        cache.get.side_effect = ConnectionError("cache unavailable")
        cache.set.side_effect = ConnectionError("cache unavailable")
    monkeypatch.setattr(
        revocation, "get_ops_client", lambda: None if cache_state == "missing" else cache
    )
    monkeypatch.setattr(
        "uniffy.core.realtime.publisher.publish_session_revoke",
        AsyncMock(side_effect=ConnectionError("notification lost")),
    )
    bearer = create_access_token(
        access.member_id, access.org_id, token_version=1, session_id=login.id
    )
    asset = create_asset_read_token(
        access.member_id, access.org_id, token_version=1, session_id=login.id
    )
    cookie = f"{resolve_asset_cookie_config().name}={asset}"
    headers = {"authorization": f"Bearer {bearer}", "sec-websocket-protocol": CANONICAL_SUBPROTOCOL}
    socket = Socket(headers)
    socket.hang_up()
    live = WSSession(
        user_id=access.member_id,
        organization_id=access.org_id,
        token_version=1,
        session_id=login.id,
        expires_at=time.time() + 600,
        conn_id=1,
        ws=socket,
    )
    interceptor = AuthenticationInterceptor()
    context = rpc_context(bearer)
    principal_token = await interceptor.on_start(context)
    await interceptor.on_end(principal_token, context, None)
    assert await get_current_user_id(asset_request(cookie)) == access.member_id
    assert await connection_denial(live) is None
    await ws_routes.realtime(socket, access.org_id)
    # The session ran until the client hung up.
    assert socket.subprotocols == [CANONICAL_SUBPROTOCOL]
    assert socket.closes == [(1011, "session ended")]

    assert await AuthOperations(session, AsyncMock()).revoke_session(access.member_id, login.id)

    with pytest.raises(ConnectError) as rpc:
        await interceptor.on_start(context)
    assert rpc.value.code == Code.UNAUTHENTICATED
    for request, authorization in (
        (asset_request(cookie), None),
        (asset_request(), f"Bearer {bearer}"),
    ):
        with pytest.raises(HTTPException) as asset_error:
            await get_current_user_id(request, authorization)
        assert asset_error.value.status_code == 401
    denial = await connection_denial(live)
    assert denial is not None and denial.code == 4410
    revoked = Socket(headers)
    await ws_routes.realtime(revoked, access.org_id)
    assert revoked.subprotocols == []
    assert revoked.closes == [(WS_CLOSE_UNAUTHENTICATED, "credentials revoked")]
    await session.refresh(login)
    assert login.is_revoked
    cache.get.assert_not_awaited()


async def test_open_socket_closes_once_its_session_is_revoked_without_notification(
    session: AsyncSession, access: SimpleNamespace, login: UserSession, monkeypatch
) -> None:
    monkeypatch.setattr(realtime_session, "REAUTH_INTERVAL_SECONDS", 0.05)
    monkeypatch.setattr(
        "uniffy.core.realtime.publisher.publish_session_revoke",
        AsyncMock(side_effect=ConnectionError("notification lost")),
    )
    bearer = create_access_token(
        access.member_id, access.org_id, token_version=1, session_id=login.id
    )
    socket = Socket({
        "authorization": f"Bearer {bearer}",
        "sec-websocket-protocol": CANONICAL_SUBPROTOCOL,
    })
    running = asyncio.create_task(ws_routes.realtime(socket, access.org_id))
    await asyncio.wait_for(socket.accepting.wait(), 5)

    assert await AuthOperations(session, AsyncMock()).revoke_session(access.member_id, login.id)

    await asyncio.wait_for(running, 5)
    assert socket.subprotocols == [CANONICAL_SUBPROTOCOL]
    assert socket.closes[0][0] == WS_CLOSE_TOKEN_REVOKED


async def test_idle_socket_cannot_attach_a_document_once_its_session_is_revoked(
    session: AsyncSession, access: SimpleNamespace, login: UserSession, monkeypatch
) -> None:
    monkeypatch.setattr(
        "uniffy.core.realtime.publisher.publish_session_revoke",
        AsyncMock(side_effect=ConnectionError("notification lost")),
    )
    bearer = create_access_token(
        access.member_id, access.org_id, token_version=1, session_id=login.id
    )
    socket = Socket({
        "authorization": f"Bearer {bearer}",
        "sec-websocket-protocol": CANONICAL_SUBPROTOCOL,
    })
    running = asyncio.create_task(ws_routes.realtime(socket, access.org_id))
    await asyncio.wait_for(socket.accepting.wait(), 5)
    assert await AuthOperations(session, AsyncMock()).revoke_session(access.member_id, login.id)

    # Long before the watchdog runs, the first document frame must not attach.
    note = doc_name_for((ContentType.NOTE, access.private_note_id))
    socket.deliver(encode_doc_frame(note, create_sync_message(pycrdt.Doc())))

    await asyncio.wait_for(running, 5)
    assert socket.closes[0][0] == WS_CLOSE_TOKEN_REVOKED
    assert socket.sent.empty()


async def test_session_must_exist_belong_to_actor_and_remain_live(session, access, login):
    assert await revocation.token_revocation(access.member_id, 1, login.id) is None
    assert (
        await revocation.token_revocation(access.peer_id, 1, login.id)
        == revocation.TokenRevocation.SESSION
    )
    assert (
        await revocation.token_revocation(access.member_id, 1, generate_id())
        == revocation.TokenRevocation.SESSION
    )
    await session.delete(login)
    await session.commit()
    assert (
        await revocation.token_revocation(access.member_id, 1, login.id)
        == revocation.TokenRevocation.SESSION
    )


async def test_account_revocation_applies_without_published_watermark(session, access, login):
    assert await revocation.token_revocation(access.member_id, None, None) is None
    await session.execute(update(User).where(User.id == access.member_id).values(token_version=2))
    await session.commit()
    assert (
        await revocation.token_revocation(access.member_id, 1, login.id)
        == revocation.TokenRevocation.TOKEN
    )
    assert (
        await revocation.token_revocation(access.member_id, None, None)
        == revocation.TokenRevocation.TOKEN
    )
    assert await revocation.token_revocation(access.member_id, 2, login.id) is None
    await session.execute(update(User).where(User.id == access.member_id).values(is_active=False))
    await session.commit()
    assert (
        await revocation.token_revocation(access.member_id, 2, login.id)
        == revocation.TokenRevocation.TOKEN
    )
    assert (
        await revocation.token_revocation(generate_id(), 1, None) == revocation.TokenRevocation.TOKEN
    )


async def test_revoking_one_session_keeps_other_session_valid(session, access, login):
    other = UserSession(user_id=access.member_id, organization_id=access.org_id)
    session.add(other)
    await session.commit()
    await session.execute(
        update(UserSession).where(UserSession.id == login.id).values(is_revoked=True)
    )
    await session.commit()
    assert (
        await revocation.token_revocation(access.member_id, 1, login.id)
        == revocation.TokenRevocation.SESSION
    )
    assert await revocation.token_revocation(access.member_id, 1, other.id) is None
