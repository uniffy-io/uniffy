import asyncio
from unittest.mock import AsyncMock, patch

import pycrdt
import pytest

from uniffy.core.realtime.multiplex import encode_doc_frame, write_var_string, write_var_uint
from uniffy.core.realtime.session import _dispatch_doc_frame
from uniffy.core.realtime.state import ClientHandle, WSSession, YDocSession, doc_name_for
from uniffy.core.realtime.wire import create_ack_message
from uniffy.core.realtime.ydoc_manager import ydoc_manager
from uniffy.core.types import ContentType, generate_id


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
