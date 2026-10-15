import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pycrdt
import pytest

from uniffy.core.realtime.markdown import PROSEMIRROR_FRAGMENT_FIELD
from uniffy.core.realtime.multiplex import encode_doc_frame
from uniffy.core.realtime.state import ClientHandle, WSSession, YDocSession, doc_name_for
from uniffy.core.realtime.storage import SeedLease
from uniffy.core.realtime.wire import create_fragment_seeder_message
from uniffy.core.realtime.ydoc_manager import YDocManager
from uniffy.core.types import ContentType, generate_id


def session_with_handles() -> tuple[YDocSession, list[ClientHandle]]:
    session = YDocSession(
        key=(ContentType.TASK, generate_id()), ydoc=pycrdt.Doc(), organization_id=generate_id()
    )
    handles = []
    for conn_id, can_edit in [(1, False), (2, True), (3, True)]:
        socket = WSSession(
            user_id=generate_id(),
            organization_id=session.organization_id,
            token_version=0,
            conn_id=conn_id,
            ws=MagicMock(),
        )
        handle = ClientHandle(
            conn_id=conn_id,
            user_id=socket.user_id,
            can_edit=can_edit,
            can_seed=True,
            token_version=0,
            ws=socket.ws,
            doc_key=session.key,
            ws_session=socket,
        )
        socket.doc_handles[session.key] = handle
        session.clients[conn_id] = handle
        handles.append(handle)
    return session, handles


def seed_frame(session: YDocSession, granted: bool) -> bytes:
    return encode_doc_frame(
        doc_name_for(session.key),
        create_fragment_seeder_message(granted, session.seed_token if granted else ""),
    )


async def test_only_database_owner_receives_seed_role_once() -> None:
    session, handles = session_with_handles()
    manager = YDocManager()
    with patch(
        "uniffy.core.realtime.ydoc_manager.claim_seed",
        AsyncMock(
            return_value=SeedLease(
                f"{manager._replica_id}:2", datetime.now(UTC) + timedelta(seconds=45)
            )
        ),
    ):
        await manager.refresh_fragment_seeder(session)
        await manager.refresh_fragment_seeder(session)
    assert session.seeder_conn_id == 2
    assert handles[0].ws_session.outbound.empty()
    assert handles[1].ws_session.outbound.get_nowait() == seed_frame(session, True)
    assert handles[1].ws_session.outbound.empty()
    assert handles[2].ws_session.outbound.empty()


async def test_other_replica_owner_prevents_local_seeding() -> None:
    session, handles = session_with_handles()
    manager = YDocManager()
    with patch(
        "uniffy.core.realtime.ydoc_manager.claim_seed",
        AsyncMock(return_value=SeedLease("other:2", datetime.now(UTC) + timedelta(seconds=45))),
    ):
        await manager.refresh_fragment_seeder(session)
    assert session.seeder_conn_id is None
    assert all(handle.ws_session.outbound.empty() for handle in handles)


async def test_plain_clients_do_not_claim_or_block_fragment_seed() -> None:
    session, handles = session_with_handles()
    manager = YDocManager()
    for handle in handles:
        handle.can_seed = False
    with patch(
        "uniffy.core.realtime.ydoc_manager.claim_seed", AsyncMock(return_value=None)
    ) as claim:
        await manager.refresh_fragment_seeder(session)
        claim.assert_not_awaited()
        handles[2].can_seed = True
        await manager.refresh_fragment_seeder(session)
        assert claim.await_args.args[2] == [f"{manager._replica_id}:3"]


async def test_role_transfer_revokes_previous_owner() -> None:
    session, handles = session_with_handles()
    manager = YDocManager()
    with patch(
        "uniffy.core.realtime.ydoc_manager.claim_seed",
        AsyncMock(
            side_effect=[
                SeedLease(f"{manager._replica_id}:2", datetime.now(UTC) + timedelta(seconds=45)),
                SeedLease(f"{manager._replica_id}:3", datetime.now(UTC) + timedelta(seconds=45)),
                None,
            ]
        ),
    ):
        await manager.refresh_fragment_seeder(session)
        handles[1].ws_session.outbound.get_nowait()
        await manager.refresh_fragment_seeder(session)
        assert handles[1].ws_session.outbound.get_nowait() == seed_frame(session, False)
        assert handles[2].ws_session.outbound.get_nowait() == seed_frame(session, True)
        await manager.refresh_fragment_seeder(session)
        assert handles[2].ws_session.outbound.get_nowait() == seed_frame(session, False)


@pytest.fixture(autouse=True)
async def stop_seed_timers():
    yield
    tasks = [
        task for task in asyncio.all_tasks() if "_refresh_seed_after" in task.get_coro().__qualname__
    ]
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


async def test_seed_lease_expiry_transfers_without_client_traffic() -> None:
    session, handles = session_with_handles()
    manager = YDocManager()
    with patch(
        "uniffy.core.realtime.ydoc_manager.claim_seed",
        AsyncMock(
            side_effect=[
                SeedLease(
                    f"{manager._replica_id}:2", datetime.now(UTC) + timedelta(milliseconds=10)
                ),
                SeedLease(f"{manager._replica_id}:3", datetime.now(UTC) + timedelta(seconds=45)),
            ]
        ),
    ):
        await manager.refresh_fragment_seeder(session)
        await asyncio.sleep(0.05)
    assert session.seeder_conn_id == 3
    assert handles[2].ws_session.outbound.get_nowait() == seed_frame(session, True)


async def test_release_all_survives_seed_database_failure() -> None:
    manager = YDocManager()
    session, handles = session_with_handles()
    manager._sessions[session.key] = session
    socket = handles[1].ws_session
    another, _ = session_with_handles()
    another.clients.clear()
    manager._sessions[another.key] = another
    manager._attach_client(another, socket, can_edit=True)
    with patch(
        "uniffy.core.realtime.ydoc_manager.claim_seed",
        AsyncMock(side_effect=OSError("database offline")),
    ):
        await manager.release_all(socket)
    assert not socket.doc_handles
    assert handles[1].closed
    assert socket.conn_id not in session.clients
    assert not another.clients
    assert another.eviction_task is not None
    another.eviction_task.cancel()
    await asyncio.gather(another.eviction_task, return_exceptions=True)
