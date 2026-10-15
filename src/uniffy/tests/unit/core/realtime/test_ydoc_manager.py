import asyncio
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pycrdt
import pytest

from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.markdown import DOC_GENERATION_KEY, DOC_META_FIELD
from uniffy.core.realtime.multiplex import peek_var_string
from uniffy.core.realtime.state import OutboundQueue, WSSession, YDocSession
from uniffy.core.realtime.storage import compact_update
from uniffy.core.realtime.wire import handle_sync_message
from uniffy.core.realtime.ydoc_manager import YDocManager
from uniffy.core.types import ContentType, generate_id


async def test_authorization_outage_preserves_handle_without_authorizing_disclosure():
    manager = YDocManager()
    key = ContentType.NOTE, generate_id()
    session = YDocSession(key=key, ydoc=pycrdt.Doc(), organization_id=generate_id())
    manager._sessions[key] = session
    socket = WSSession(
        user_id=generate_id(),
        organization_id=session.organization_id,
        token_version=1,
        conn_id=1,
        ws=AsyncMock(),
    )
    handle = manager._attach_client(session, socket, can_edit=True)
    adapter = MagicMock()
    adapter.authorize = AsyncMock(side_effect=OSError("database unavailable"))

    @asynccontextmanager
    async def open_db():
        yield MagicMock()

    with (
        patch("uniffy.core.realtime.ydoc_manager.open_session", open_db),
        patch("uniffy.core.realtime.ydoc_manager.get_realtime_adapter", return_value=adapter),
    ):
        with pytest.raises(OSError, match="database unavailable"):
            await manager._reauthorize_docs([key], socket.user_id)
    assert not handle.closed
    assert key not in socket.denied_docs
    assert socket.outbound.empty()


@pytest.mark.parametrize("generation", ["saved-generation", None])
async def test_snapshot_hydrate_preserves_generation(generation: str | None) -> None:
    saved = pycrdt.Doc()
    if generation is not None:
        saved.get(DOC_META_FIELD, type=pycrdt.Map)[DOC_GENERATION_KEY] = generation
    db = MagicMock()
    db.commit = AsyncMock()
    adapter = MagicMock()
    adapter.hydrate_ydoc = AsyncMock()
    adapter.policy_key = AsyncMock(return_value=None)

    @asynccontextmanager
    async def open_db():
        yield db

    with (
        patch("uniffy.core.realtime.ydoc_manager.open_session", open_db),
        patch("uniffy.core.realtime.ydoc_manager.lock_document", AsyncMock()),
        patch(
            "uniffy.core.realtime.ydoc_manager.stage_seed",
            AsyncMock(return_value=MagicMock(updates=saved.get_update())),
        ),
        patch("uniffy.core.realtime.ydoc_manager.get_realtime_adapter", return_value=adapter),
    ):
        hydrated = await YDocManager()._hydrate((ContentType.NOTE, generate_id()), generate_id())
    assert hydrated.ydoc.get(DOC_META_FIELD, type=pycrdt.Map).get(DOC_GENERATION_KEY) == generation
    adapter.hydrate_ydoc.assert_not_awaited()


async def test_failed_eviction_retains_document_and_retries() -> None:
    manager = YDocManager()
    key = (ContentType.TASK, generate_id())
    doc = pycrdt.Doc()
    doc["markdown"] = pycrdt.Text("pending work")
    session = YDocSession(key=key, ydoc=doc, organization_id=generate_id())
    manager._sessions[key] = session
    with (
        patch("uniffy.core.realtime.ydoc_manager.IDLE_EVICTION_SECONDS", 0),
        patch(
            "uniffy.core.realtime.ydoc_manager.snapshot_writer.flush",
            AsyncMock(side_effect=OSError("database unavailable")),
        ),
        patch("uniffy.core.realtime.ydoc_manager.router.unregister_doc_session") as unregister,
    ):
        await manager._evict_after_idle(key)
        assert manager._sessions[key] is session
        assert session.eviction_task is not None
        unregister.assert_not_called()
        session.eviction_task.cancel()
        await asyncio.gather(session.eviction_task, return_exceptions=True)


async def test_deltas_preserve_inserts_and_deletes_without_rebroadcasting_unchanged_revision():

    manager = YDocManager()
    doc = pycrdt.Doc()
    doc["markdown"] = pycrdt.Text("x" * 32000)
    doc.get("doc_meta", type=pycrdt.Map)["generation"] = "g"
    key = ContentType.NOTE, generate_id()
    session = YDocSession(key=key, ydoc=doc, organization_id=generate_id(), revision=0)
    socket = WSSession(
        user_id=generate_id(),
        organization_id=session.organization_id,
        token_version=1,
        conn_id=1,
        ws=AsyncMock(),
    )
    manager._attach_client(session, socket, can_edit=True)
    peer = pycrdt.Doc()
    peer.apply_update(doc.get_update())
    writer = pycrdt.Doc()
    writer.apply_update(doc.get_update())
    writer.get("markdown", type=pycrdt.Text).insert(16000, "new")
    snapshot = RealtimeYjsSnapshot(
        content_type=key[0],
        content_id=key[1],
        generation="g",
        revision=1,
        state_vector=writer.get_state(),
        updates=writer.get_update(),
    )
    manager._apply_snapshot(session, snapshot)
    frame = socket.outbound.get_nowait()
    assert len(frame) < 200
    _, offset = peek_var_string(frame)
    handle_sync_message(frame[offset + 1 :], peer)
    assert str(peer.get("markdown", type=pycrdt.Text)) == "x" * 16000 + "new" + "x" * 16000
    manager._apply_snapshot(session, snapshot)
    assert socket.outbound.empty()
    del writer.get("markdown", type=pycrdt.Text)[:1]
    snapshot.updates, snapshot.state_vector, snapshot.revision = (
        writer.get_update(),
        writer.get_state(),
        2,
    )
    manager._apply_snapshot(session, snapshot)
    frame = socket.outbound.get_nowait()
    _, offset = peek_var_string(frame)
    handle_sync_message(frame[offset + 1 :], peer)
    assert str(peer.get("markdown", type=pycrdt.Text)) == "x" * 15999 + "new" + "x" * 16000


async def test_outbound_byte_budget_reclaims_drained_bytes():
    queue = OutboundQueue(max_bytes=10)
    queue.put_nowait(b"12345678")
    with pytest.raises(asyncio.QueueFull):
        queue.put_nowait(b"abc")
    assert await queue.get() == b"12345678"
    await queue.put(b"abcdefghij")
    assert queue.queued_bytes == 10
    with pytest.raises(asyncio.QueueFull):
        await queue.put(b"too many bytes")


def test_compaction_retains_missing_predecessors_and_collects_deleted_text():
    doc = pycrdt.Doc()
    doc["markdown"] = pycrdt.Text("base")
    baseline = doc.get_update()
    before = doc.get_state()
    doc.get("markdown", type=pycrdt.Text).insert(4, " first")
    predecessor = doc.get_update(before)
    before = doc.get_state()
    doc.get("markdown", type=pycrdt.Text).insert(10, " second")
    raw = pycrdt.merge_updates(baseline, doc.get_update(before))
    recovered = pycrdt.Doc()
    recovered.apply_update(compact_update(raw))
    recovered.apply_update(predecessor)
    assert str(recovered.get("markdown", type=pycrdt.Text)) == "base first second"
    raw = doc.get_update()
    before = doc.get_state()
    doc.get("markdown", type=pycrdt.Text).insert(0, "z" * 10000)
    raw = pycrdt.merge_updates(raw, doc.get_update(before))
    before = doc.get_state()
    del doc.get("markdown", type=pycrdt.Text)[:10000]
    raw = pycrdt.merge_updates(raw, doc.get_update(before))
    compacted = compact_update(raw)
    assert len(compacted) < len(raw) // 10
    peer = pycrdt.Doc()
    peer.apply_update(compacted)
    assert str(peer.get("markdown", type=pycrdt.Text)) == "base first second"
