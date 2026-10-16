"""Upgrade admission and durable credential revocation across RPC, asset reads and live sockets."""

import asyncio
import contextlib
import time
from collections.abc import AsyncIterator
from types import SimpleNamespace
from uuid import UUID

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
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.models.login.user_session import UserSession
from uniffy.core.realtime import session as realtime_session
from uniffy.core.realtime import ws_routes
from uniffy.core.realtime.auth import (
    CANONICAL_SUBPROTOCOL,
    WS_CLOSE_FORBIDDEN,
    WS_CLOSE_REAUTH_REQUIRED,
    WS_CLOSE_TOKEN_REVOKED,
    WS_CLOSE_UNAUTHENTICATED,
    WS_CLOSE_UPGRADE_REQUIRED,
)
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.realtime.limits import MAX_SOCKETS_PER_USER
from uniffy.core.realtime.multiplex import encode_doc_frame
from uniffy.core.realtime.publisher import publish_token_revoke
from uniffy.core.realtime.reauth import (
    MAX_SOCKET_LIFETIME_SECONDS,
    connection_denial,
    socket_deadline,
)
from uniffy.core.realtime.state import WSSession, doc_name_for
from uniffy.core.realtime.wire import YMessageType, YSyncMessageType, create_sync_message
from uniffy.core.realtime.ydoc_manager import YDocManager
from uniffy.core.types import AccessMode, ContentType, generate_id
from uniffy.domains.auth.interceptors import AuthenticationInterceptor
from uniffy.domains.auth.operations import AuthOperations
from uniffy.domains.calls.channels import CallsLifecycle
from uniffy.infrastructure.database.session import open_session
from uniffy.infrastructure.valkey.ops import close_ops_client, init_ops_client
from uniffy.tests.integration.access.realtime_documents import create_document, discard
from uniffy.tests.integration.access.realtime_live import BufferedDocument
from uniffy.tests.integration.access.realtime_sockets import (
    FRAME_TIMEOUT,
    Client,
    Socket,
    bearer,
    connect,
    routed,
    session_state,
    step,
    subscribed,
    upgrade_socket,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def serve(socket: Socket, organization: UUID) -> None:
    """Run one upgrade on a replica of its own; these sockets attach no document."""
    buffer = UpdateBuffer(namespace=f"test:{generate_id().hex}:")
    await ws_routes.serve_realtime(socket, organization, YDocManager(buffer=buffer))


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


def live_socket(access: SimpleNamespace, login: UserSession, **fields) -> WSSession:
    return WSSession(
        user_id=access.member_id,
        organization_id=access.org_id,
        token_version=1,
        session_id=login.id,
        conn_id=1,
        ws=Socket(),
        **{"expires_at": time.time() + 600, **fields},
    )


async def revoke(session: AsyncSession, user: UUID, login: UserSession) -> None:
    assert await AuthOperations(session, CallsLifecycle(open_session)).revoke_session(user, login.id)


@pytest.mark.parametrize("cache", ["closed", "live"])
async def test_committed_logout_rejects_old_credentials_whatever_the_cache_holds(
    session: AsyncSession, access: SimpleNamespace, login: UserSession, cache: str
) -> None:
    bearer_token = create_access_token(
        access.member_id, access.org_id, token_version=1, session_id=login.id
    )
    asset = create_asset_read_token(
        access.member_id, access.org_id, token_version=1, session_id=login.id
    )
    cookie = f"{resolve_asset_cookie_config().name}={asset}"
    headers = {
        "authorization": f"Bearer {bearer_token}",
        "sec-websocket-protocol": CANONICAL_SUBPROTOCOL,
    }
    socket = Socket(headers)
    socket.hang_up()
    live = live_socket(access, login)
    interceptor = AuthenticationInterceptor()
    context = rpc_context(bearer_token)
    principal_token = await interceptor.on_start(context)
    await interceptor.on_end(principal_token, context, None)
    assert await get_current_user_id(asset_request(cookie)) == access.member_id
    assert await connection_denial(live) is None
    await serve(socket, access.org_id)
    # The session ran until the client hung up.
    assert socket.subprotocols == [CANONICAL_SUBPROTOCOL]
    assert socket.closes == [(1011, "session ended")]

    if cache == "closed":
        await close_ops_client()
    try:
        await revoke(session, access.member_id, login)

        with pytest.raises(ConnectError) as rpc:
            await interceptor.on_start(context)
        assert rpc.value.code == Code.UNAUTHENTICATED
        for request, authorization in (
            (asset_request(cookie), None),
            (asset_request(), f"Bearer {bearer_token}"),
        ):
            with pytest.raises(HTTPException) as asset_error:
                await get_current_user_id(request, authorization)
            assert asset_error.value.status_code == 401
        denial = await connection_denial(live)
        assert denial is not None
        assert (denial.code, denial.metric_reason) == (WS_CLOSE_TOKEN_REVOKED, "session_revoked")
        revoked = Socket(headers)
        await serve(revoked, access.org_id)
        assert revoked.subprotocols == []
        assert revoked.closes == [(WS_CLOSE_UNAUTHENTICATED, "credentials revoked")]
    finally:
        await init_ops_client()
    await session.refresh(login)
    assert login.is_revoked


async def test_open_socket_closes_once_its_session_is_revoked_without_notification(
    session: AsyncSession, access: SimpleNamespace, login: UserSession, monkeypatch
) -> None:
    monkeypatch.setattr(realtime_session, "REAUTH_INTERVAL_SECONDS", 0.05)
    token = create_access_token(
        access.member_id, access.org_id, token_version=1, session_id=login.id
    )
    socket = Socket({
        "authorization": f"Bearer {token}",
        "sec-websocket-protocol": CANONICAL_SUBPROTOCOL,
    })
    running = asyncio.create_task(serve(socket, access.org_id))
    await asyncio.wait_for(socket.accepting.wait(), 5)

    # No router runs in this process, so only the durable check can close the socket.
    await revoke(session, access.member_id, login)

    await asyncio.wait_for(running, 5)
    assert socket.subprotocols == [CANONICAL_SUBPROTOCOL]
    assert socket.closes[0][0] == WS_CLOSE_TOKEN_REVOKED


async def test_idle_socket_cannot_attach_a_document_once_its_session_is_revoked(
    session: AsyncSession, access: SimpleNamespace, login: UserSession
) -> None:
    token = create_access_token(
        access.member_id, access.org_id, token_version=1, session_id=login.id
    )
    socket = Socket({
        "authorization": f"Bearer {token}",
        "sec-websocket-protocol": CANONICAL_SUBPROTOCOL,
    })
    running = asyncio.create_task(serve(socket, access.org_id))
    await asyncio.wait_for(socket.accepting.wait(), 5)
    await revoke(session, access.member_id, login)

    # Long before the watchdog runs, the first document frame must not attach.
    note = doc_name_for((ContentType.NOTE, access.private_note_id))
    socket.deliver(encode_doc_frame(note, create_sync_message(pycrdt.Doc())))

    await asyncio.wait_for(running, 5)
    assert socket.closes[0][0] == WS_CLOSE_TOKEN_REVOKED
    assert socket.sent.empty()


@pytest.mark.parametrize(
    ("loss", "expected"),
    [
        ("token_revoked", (WS_CLOSE_TOKEN_REVOKED, "token_revoked")),
        ("membership_revoked", (WS_CLOSE_FORBIDDEN, "membership_revoked")),
        # Expiry refreshes and reconnects; a revocation code would stop the client for good.
        ("token_expired", (WS_CLOSE_REAUTH_REQUIRED, "token_expired")),
    ],
)
async def test_live_socket_is_denied_once_a_fact_behind_its_upgrade_stops_holding(
    session: AsyncSession,
    access: SimpleNamespace,
    login: UserSession,
    loss: str,
    expected: tuple[int, str],
) -> None:
    live = live_socket(access, login)
    assert await connection_denial(live) is None

    if loss == "token_revoked":
        await session.execute(
            update(User).where(User.id == access.member_id).values(token_version=2)
        )
    elif loss == "membership_revoked":
        # Removing a member publishes no realtime signal of its own.
        await session.execute(
            update(OrganizationMember)
            .where(
                OrganizationMember.organization_id == access.org_id,
                OrganizationMember.user_id == access.member_id,
            )
            .values(is_active=False)
        )
    else:
        live.expires_at = time.time() - 1
    await session.commit()

    denial = await connection_denial(live)
    assert denial is not None
    assert (denial.code, denial.metric_reason) == expected


async def test_token_without_expiry_still_has_a_lifetime_ceiling(
    access: SimpleNamespace, login: UserSession
) -> None:
    opened = time.time() - MAX_SOCKET_LIFETIME_SECONDS - 1
    live = live_socket(access, login, expires_at=None, connected_at=opened)

    assert socket_deadline(live) == opened + MAX_SOCKET_LIFETIME_SECONDS
    denial = await connection_denial(live)
    assert denial is not None
    assert denial.metric_reason == "token_expired"


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


async def attach_as(
    manager: YDocManager, doc: BufferedDocument, user: UUID, version: int | None
) -> tuple[Client, list[bytes]]:
    client = connect(manager, doc.key, doc.org, user, token_version=version)
    client.sync()
    _, frames = await client.until(YMessageType.SYNC, step(YSyncMessageType.SYNC_STEP2))
    return client, frames


async def test_token_revoke_fanout_closes_only_older_tokens_of_that_user(
    session: AsyncSession, access: SimpleNamespace, buffer: UpdateBuffer
) -> None:
    doc = (await create_document(access, buffer, ContentType.NOTE, AccessMode.OPEN_TO_ORG)).doc
    clients: dict[str, Client] = {}
    try:
        async with routed(doc, 1) as (manager,):
            try:
                # Tokens without a version count as the first one.
                for name, user, version in (
                    ("stale", doc.owner, 1),
                    ("unversioned", doc.owner, None),
                    ("peer", doc.peer, 1),
                ):
                    clients[name], _ = await attach_as(manager, doc, user, version)
                # Logging out every device bumps the account version; a new login carries it.
                await session.execute(
                    update(User).where(User.id == doc.owner).values(token_version=2)
                )
                await session.commit()
                clients["fresh"], frames = await attach_as(manager, doc, doc.owner, 2)
                await subscribed(clients["fresh"], session_state(frames))

                await publish_token_revoke(doc.owner, 2)

                for name in ("stale", "unversioned"):
                    await asyncio.wait_for(clients[name].task, FRAME_TIMEOUT)
                    # The watchdog would say "credentials revoked"; this close is the fanout's.
                    assert clients[name].socket.closes[0] == (
                        WS_CLOSE_TOKEN_REVOKED,
                        "token revoked",
                    )
                for name in ("fresh", "peer"):
                    clients[name].sync()
                    await clients[name].until(YMessageType.SYNC, step(YSyncMessageType.SYNC_STEP2))
                    assert clients[name].socket.closes == []
            finally:
                for client in clients.values():
                    await client.leave()
    finally:
        await discard(doc.key)


@contextlib.asynccontextmanager
async def upgrades_held(user: UUID, organization: UUID, count: int) -> AsyncIterator[list[Socket]]:
    """``count`` upgrades for ``user`` paused at acceptance, each holding one socket slot."""
    sockets: list[Socket] = []
    tasks: list[asyncio.Task[None]] = []
    release = asyncio.Event()
    try:
        for _ in range(count):
            socket = upgrade_socket(bearer(user, organization))
            socket.hold_accept = release
            sockets.append(socket)
            tasks.append(asyncio.create_task(serve(socket, organization)))
            await asyncio.wait_for(socket.accepting.wait(), FRAME_TIMEOUT)
        yield sockets
    finally:
        release.set()
        for socket in sockets:
            socket.hang_up()
        await asyncio.gather(*tasks)


async def admitted(user: UUID, organization: UUID) -> bool:
    """Whether a fresh upgrade for ``user`` is accepted; it hangs up straight away."""
    socket = upgrade_socket(bearer(user, organization))
    socket.hang_up()
    await serve(socket, organization)
    return socket.subprotocols == [CANONICAL_SUBPROTOCOL]


async def test_overlapping_upgrades_cannot_claim_the_same_slot(access: SimpleNamespace) -> None:
    user, org = access.member_id, access.org_id
    async with upgrades_held(user, org, MAX_SOCKETS_PER_USER - 1):
        async with upgrades_held(user, org, 1) as (first,):
            second = upgrade_socket(bearer(user, org))
            await serve(second, org)
            assert second.subprotocols == []
            assert second.closes == [(1013, "too many connections")]
        assert first.subprotocols == [CANONICAL_SUBPROTOCOL]
        assert await admitted(user, org)


async def test_full_user_does_not_block_another_user(access: SimpleNamespace) -> None:
    async with upgrades_held(access.peer_id, access.org_id, MAX_SOCKETS_PER_USER):
        assert not await admitted(access.peer_id, access.org_id)
        assert await admitted(access.member_id, access.org_id)


@pytest.mark.parametrize("phase", ["accept_fails", "accept_cancelled", "session_cancelled"])
async def test_failed_or_cancelled_upgrades_release_their_slot(
    access: SimpleNamespace, phase: str
) -> None:
    user, org = access.member_id, access.org_id
    async with upgrades_held(user, org, MAX_SOCKETS_PER_USER - 1):
        socket = upgrade_socket(bearer(user, org))
        if phase == "accept_fails":
            socket.accept_error = RuntimeError("handshake failed")
        else:
            socket.hold_accept = asyncio.Event()
            if phase == "session_cancelled":
                socket.hold_accept.set()
        pending = asyncio.create_task(serve(socket, org))
        await asyncio.wait_for(socket.accepting.wait(), FRAME_TIMEOUT)
        if phase == "accept_fails":
            with pytest.raises(RuntimeError):
                await pending
        else:
            await asyncio.sleep(0.05)
            pending.cancel()
            with pytest.raises(asyncio.CancelledError):
                await pending
        # With every other slot held, only the one this upgrade gave back admits a replacement.
        assert await admitted(user, org)


@pytest.mark.parametrize(
    ("protocols", "selected"),
    [("uniffy.realtime.v1", "uniffy.realtime.v1"), (None, None)],
)
async def test_authenticated_upgrade_without_v2_is_closed_with_upgrade_required(
    access: SimpleNamespace, protocols: str | None, selected: str | None
) -> None:
    user, org = access.member_id, access.org_id
    headers = {"authorization": f"Bearer {bearer(user, org)}"}
    if protocols is not None:
        headers["sec-websocket-protocol"] = protocols
    socket = Socket(headers)

    async with upgrades_held(user, org, MAX_SOCKETS_PER_USER - 1):
        await serve(socket, org)
        assert await admitted(user, org)

    # The handshake selects a protocol the client offered so a browser receives the code.
    assert socket.subprotocols == [selected]
    assert socket.closes == [(WS_CLOSE_UPGRADE_REQUIRED, "upgrade required")]


async def test_unauthenticated_upgrade_without_v2_gets_no_handshake(
    access: SimpleNamespace,
) -> None:
    socket = Socket({"sec-websocket-protocol": "uniffy.realtime.v1, bearer.not-a-token"})

    await serve(socket, access.org_id)

    assert socket.subprotocols == []
    assert socket.closes == [(WS_CLOSE_UNAUTHENTICATED, "invalid token")]
