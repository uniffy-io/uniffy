import asyncio
from unittest.mock import AsyncMock, patch

import pycrdt
import pytest

from uniffy.core.json_codec import dumps_str, loads
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.multiplex import (
    encode_doc_frame,
    read_var_string,
    read_var_uint,
    write_var_string,
    write_var_uint,
)
from uniffy.core.realtime.session import _dispatch_doc_frame
from uniffy.core.realtime.state import ClientHandle, WSSession, YDocSession, doc_name_for
from uniffy.core.realtime.wire import create_ack_message, create_auth_denied_message
from uniffy.core.realtime.ydoc_manager import ydoc_manager
from uniffy.core.types import ContentType, generate_id


async def test_awareness_dispatch_replaces_claimed_identity_and_refuses_peer_removal():
    key = ContentType.NOTE, generate_id()
    socket = WSSession(
        user_id=generate_id(),
        organization_id=generate_id(),
        token_version=1,
        conn_id=1,
        ws=AsyncMock(),
    )
    session = YDocSession(key=key, organization_id=socket.organization_id, ydoc=pycrdt.Doc())
    handle = ydoc_manager._attach_client(session, socket, can_edit=True)
    handle.awareness_user = {"id": str(socket.user_id), "name": "Authenticated user"}

    def frame(client_id, state):
        data = (
            write_var_uint(1)
            + write_var_uint(client_id)
            + write_var_uint(1)
            + write_var_string(dumps_str(state))
        )
        return bytes([1]) + write_var_uint(len(data)) + data

    broadcast = AsyncMock()
    with (
        patch.dict(ydoc_manager._sessions, {key: session}),
        patch.object(ydoc_manager, "_reauthorize_docs", AsyncMock()),
        patch.object(ydoc_manager, "broadcast_awareness", broadcast),
    ):
        await _dispatch_doc_frame(
            socket.ws,
            socket,
            handle,
            doc_name_for(key),
            frame(
                10,
                {
                    "user": {"id": str(generate_id()), "name": "Forged name"},
                    "cursor": {"anchor": 3},
                },
            ),
        )
        sent = broadcast.await_args.args[1]
        _, offset = read_var_uint(sent, 1)
        for _ in range(3):
            _, offset = read_var_uint(sent, offset)
        raw, _ = read_var_string(sent, offset)
        state = loads(raw)
        assert state["user"] == handle.awareness_user
        assert state["cursor"] == {"anchor": 3}
        await _dispatch_doc_frame(socket.ws, socket, handle, doc_name_for(key), frame(11, None))
        broadcast.assert_awaited_once()
        await _dispatch_doc_frame(socket.ws, socket, handle, doc_name_for(key), frame(10, None))
        await _dispatch_doc_frame(socket.ws, socket, handle, doc_name_for(key), frame(12, {}))
        assert broadcast.await_count == 3
        assert handle.awareness_client_id == 12


async def test_committed_update_ack_does_not_wait_for_publish() -> None:
    key = ContentType.NOTE, generate_id()
    socket = WSSession(
        user_id=generate_id(),
        organization_id=generate_id(),
        token_version=1,
        conn_id=1,
        ws=AsyncMock(),
    )
    doc = pycrdt.Doc()
    doc["markdown"] = pycrdt.Text("committed")
    session = YDocSession(key=key, organization_id=socket.organization_id, ydoc=pycrdt.Doc())
    handle = ydoc_manager._attach_client(session, socket, can_edit=True)
    snapshot = RealtimeYjsSnapshot(
        content_type=key[0],
        content_id=key[1],
        organization_id=socket.organization_id,
        generation="g",
        revision=1,
        updates=doc.get_update(),
        state_vector=doc.get_state(),
    )
    blocked = asyncio.Event()
    publish_started = asyncio.Event()

    async def publish(*args, **kwargs):
        publish_started.set()
        await blocked.wait()

    update = doc.get_update()
    payload = (
        bytes([6])
        + write_var_string("g")
        + write_var_string("write")
        + write_var_uint(len(update))
        + update
    )
    with (
        patch.dict(ydoc_manager._sessions, {key: session}),
        patch.object(ydoc_manager, "_reauthorize_docs", AsyncMock()),
        patch.object(ydoc_manager, "refresh_fragment_seeder", AsyncMock()),
        patch("uniffy.core.realtime.ydoc_manager.accept_update", AsyncMock(return_value=snapshot)),
        patch("uniffy.core.realtime.ydoc_manager.publish_doc_update", side_effect=publish),
        patch("uniffy.core.realtime.ydoc_manager.snapshot_writer.schedule", AsyncMock()),
    ):
        try:
            async with asyncio.timeout(1):
                await _dispatch_doc_frame(socket.ws, socket, handle, doc_name_for(key), payload)
                await publish_started.wait()
            frames = []
            while not socket.outbound.empty():
                frames.append(socket.outbound.get_nowait())
            assert encode_doc_frame(doc_name_for(key), create_ack_message("write")) in frames
            assert str(session.ydoc.get("markdown", type=pycrdt.Text)) == "committed"
            assert not blocked.is_set()
        finally:
            blocked.set()
            await asyncio.gather(*ydoc_manager._effect_tasks.values())


@pytest.mark.parametrize("commit_succeeds", [True, False])
async def test_ack_waits_for_durable_acceptance(commit_succeeds: bool) -> None:
    key = ContentType.NOTE, generate_id()
    socket = WSSession(
        user_id=generate_id(),
        organization_id=generate_id(),
        token_version=1,
        conn_id=1,
        ws=AsyncMock(),
    )
    handle = ClientHandle(
        conn_id=1,
        user_id=socket.user_id,
        can_edit=True,
        token_version=1,
        ws=socket.ws,
        ws_session=socket,
        doc_key=key,
    )
    session = YDocSession(key=key, organization_id=socket.organization_id, ydoc=pycrdt.Doc())
    started, commit = asyncio.Event(), asyncio.Event()

    async def accept(*args, **kwargs):
        started.set()
        await commit.wait()
        if not commit_succeeds:
            raise OSError("database unavailable")

    update = session.ydoc.get_update()
    payload = (
        bytes([6])
        + write_var_string("generation")
        + write_var_string("update-1")
        + write_var_uint(len(update))
        + update
    )
    with (
        patch.dict(ydoc_manager._sessions, {key: session}),
        patch.object(ydoc_manager, "_reauthorize_docs", AsyncMock()),
        patch.object(ydoc_manager, "apply_local_update", side_effect=accept),
    ):
        pending = asyncio.create_task(
            _dispatch_doc_frame(socket.ws, socket, handle, doc_name_for(key), payload)
        )
        await started.wait()
        assert socket.outbound.empty()
        commit.set()
        if commit_succeeds:
            await pending
            assert socket.outbound.get_nowait() == encode_doc_frame(
                doc_name_for(key), create_ack_message("update-1")
            )
        else:
            with pytest.raises(OSError):
                await pending
            assert socket.outbound.empty()


@pytest.mark.parametrize(
    "payload", [b"\x06", b"\x08\xff", b"\x06\x01g\x01i\x02x", b"\x06\x01g\x01i\x01x"]
)
async def test_corrupt_update_is_scoped_to_document(payload):
    key = ContentType.NOTE, generate_id()
    socket = WSSession(
        user_id=generate_id(),
        organization_id=generate_id(),
        token_version=1,
        conn_id=1,
        ws=AsyncMock(),
    )
    handle = ClientHandle(
        conn_id=1,
        user_id=socket.user_id,
        can_edit=True,
        token_version=1,
        ws=socket.ws,
        ws_session=socket,
        doc_key=key,
    )
    session = YDocSession(key=key, organization_id=socket.organization_id, ydoc=pycrdt.Doc())

    async def apply(session, update, **kwargs):
        session.ydoc.apply_update(update)

    with (
        patch.dict(ydoc_manager._sessions, {key: session}),
        patch.object(ydoc_manager, "_reauthorize_docs", AsyncMock()),
        patch.object(ydoc_manager, "apply_local_update", side_effect=apply),
    ):
        await _dispatch_doc_frame(socket.ws, socket, handle, doc_name_for(key), payload)
        assert socket.outbound.get_nowait() == encode_doc_frame(
            doc_name_for(key), create_auth_denied_message("invalid update")
        )
        update = pycrdt.Doc().get_update()
        valid = (
            bytes([6])
            + write_var_string("g")
            + write_var_string("next")
            + write_var_uint(len(update))
            + update
        )
        await _dispatch_doc_frame(socket.ws, socket, handle, doc_name_for(key), valid)
        assert socket.outbound.get_nowait() == encode_doc_frame(
            doc_name_for(key), create_ack_message("next")
        )
    socket.ws.close.assert_not_awaited()


async def test_seed_base_uses_document_limit_instead_of_docname_limit():
    key = ContentType.NOTE, generate_id()
    socket = WSSession(
        user_id=generate_id(),
        organization_id=generate_id(),
        token_version=1,
        conn_id=1,
        ws=AsyncMock(),
    )
    handle = ClientHandle(
        conn_id=1,
        user_id=socket.user_id,
        can_edit=True,
        token_version=1,
        ws=socket.ws,
        ws_session=socket,
        doc_key=key,
    )
    session = YDocSession(key=key, organization_id=socket.organization_id, ydoc=pycrdt.Doc())
    source = "é" * 20_000
    update = session.ydoc.get_update()
    payload = (
        bytes([8])
        + write_var_string("g")
        + write_var_string("seed")
        + write_var_string("lease")
        + write_var_string(source)
        + write_var_uint(len(update))
        + update
    )
    accept = AsyncMock()
    with (
        patch.dict(ydoc_manager._sessions, {key: session}),
        patch.object(ydoc_manager, "_reauthorize_docs", AsyncMock()),
        patch.object(ydoc_manager, "apply_local_update", accept),
    ):
        await _dispatch_doc_frame(socket.ws, socket, handle, doc_name_for(key), payload)
    assert accept.await_args.kwargs["seed_base"] == source
    assert socket.outbound.get_nowait() == encode_doc_frame(
        doc_name_for(key), create_ack_message("seed")
    )
