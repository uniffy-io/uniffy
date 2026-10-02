from unittest.mock import AsyncMock, MagicMock, patch

import pycrdt

from uniffy.core.realtime.markdown import PROSEMIRROR_FRAGMENT_FIELD
from uniffy.core.realtime.multiplex import encode_doc_frame
from uniffy.core.realtime.state import ClientHandle, WSSession, YDocSession, doc_name_for
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
    return encode_doc_frame(doc_name_for(session.key), create_fragment_seeder_message(granted))


async def test_only_database_owner_receives_seed_role_once() -> None:
    session, handles = session_with_handles()
    manager = YDocManager()
    with patch(
        "uniffy.core.realtime.ydoc_manager.claim_seed",
        AsyncMock(return_value=f"{manager._replica_id}:2"),
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
    with patch("uniffy.core.realtime.ydoc_manager.claim_seed", AsyncMock(return_value="other:2")):
        await manager.refresh_fragment_seeder(session)
    assert session.seeder_conn_id is None
    assert all(handle.ws_session.outbound.empty() for handle in handles)


async def test_role_transfer_revokes_previous_owner() -> None:
    session, handles = session_with_handles()
    manager = YDocManager()
    with patch(
        "uniffy.core.realtime.ydoc_manager.claim_seed",
        AsyncMock(side_effect=[f"{manager._replica_id}:2", f"{manager._replica_id}:3", None]),
    ):
        await manager.refresh_fragment_seeder(session)
        handles[1].ws_session.outbound.get_nowait()
        await manager.refresh_fragment_seeder(session)
        assert handles[1].ws_session.outbound.get_nowait() == seed_frame(session, False)
        assert handles[2].ws_session.outbound.get_nowait() == seed_frame(session, True)
        await manager.refresh_fragment_seeder(session)
        assert handles[2].ws_session.outbound.get_nowait() == seed_frame(session, False)
