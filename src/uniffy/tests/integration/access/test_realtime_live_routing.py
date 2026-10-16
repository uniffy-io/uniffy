"""Real in-process sockets against resident replicas whose live edits go through the buffer."""

import asyncio
from collections.abc import AsyncIterator, Callable
from typing import Any

import pytest
import pytest_asyncio

from uniffy.core.realtime.buffer_keys import BufferScope
from uniffy.core.realtime.checkpoint import CheckpointStatus, checkpoint_document
from uniffy.core.realtime.markdown import markdown_text
from uniffy.core.realtime.multiplex import write_var_string
from uniffy.core.realtime.publisher import publish_checkpoint_progress
from uniffy.core.realtime.storage import lock_document
from uniffy.core.realtime.wire import (
    MESSAGE_ACCEPTED_RECEIPT,
    MESSAGE_CHECKPOINT_PROGRESS,
    MESSAGE_COMMITTED,
    MESSAGE_GENERATION,
    MESSAGE_SESSION_STATE,
    Y_MESSAGE_AUTH,
    AcceptedReceipt,
    CheckpointProgress,
    SessionState,
    YMessageType,
    YSyncMessageType,
    parse_accepted_receipt_message,
    parse_checkpoint_progress_message,
    parse_committed_message,
    parse_generation_message,
    parse_session_state_message,
    sync_step1_state_vector,
)
from uniffy.core.realtime.ydoc_manager import YDocManager
from uniffy.core.types import ContentType
from uniffy.infrastructure.database.session import open_session
from uniffy.tests.integration.access.realtime_documents import discard
from uniffy.tests.integration.access.realtime_live import (
    BufferedDocument,
    buffered,
    buffering_disabled,
    document,
    live_note,  # noqa: F401 - fixture
    stored,
    text_of,
    typed,
    unreachable,
    valkey,
)
from uniffy.tests.integration.access.realtime_sockets import (
    FRAME_TIMEOUT,
    QUIET_SECONDS,
    attach,
    attached,
    connect,
    denial,
    evicted,
    kinds,
    replica,
    resident_text,
    routed,
    session_state,
    step,
    subscribed,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")

UNAVAILABLE = "unavailable"


def trimmed(*history: bytes) -> bytes:
    """A client edit deleting the first character."""
    doc = document(*history)
    before = doc.get_state()
    del markdown_text(doc)[:1]
    return doc.get_update(before)


def announces(epoch: str) -> Callable[[bytes], bool]:
    """Checkpoint progress naming ``epoch``."""
    return lambda payload: (
        payload[0] == MESSAGE_CHECKPOINT_PROGRESS
        and parse_checkpoint_progress_message(payload).epoch == epoch
    )


def covering(payload: bytes) -> bool:
    return parse_checkpoint_progress_message(payload).covered_sequence > 0


@pytest_asyncio.fixture(loop_scope="session")
async def manager(live_note: BufferedDocument) -> AsyncIterator[YDocManager]:
    manager = replica(live_note.buffer)
    yield manager
    await manager.drain_for_shutdown()
    await evicted(manager, live_note.key)


async def test_attach_and_resync_send_generation_then_session_state_before_sync(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    async with (
        attached(manager, live_note) as (client, frames),
        attached(manager, live_note) as (_, again),
    ):
        row = await stored(live_note.key)
        # The attach handshake already answers the first SyncStep1, so it is not repeated, and
        # nothing asks a client that holds no unknown updates for its state.
        assert kinds(frames) == [MESSAGE_GENERATION, MESSAGE_SESSION_STATE]
        assert parse_generation_message(frames[0]) == live_note.generation
        expected = SessionState(live_note.generation, live_note.head.scope.epoch, 0, 0, row.revision)
        assert parse_session_state_message(frames[1]) == expected
        assert kinds(again) == kinds(frames)
        client.sync()
        _, resync = await client.until(YMessageType.SYNC, step(YSyncMessageType.SYNC_STEP2))
        assert kinds(resync) == [MESSAGE_GENERATION, MESSAGE_SESSION_STATE]
        assert parse_session_state_message(resync[1]) == expected
        assert client.markdown == "base"


async def test_edit_answers_receipt_and_leaves_snapshot_row_unchanged(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    async with attached(manager, live_note) as (client, frames):
        before = await stored(live_note.key)
        client.write("edit-1", typed(live_note.base, suffix=" typed"), live_note.generation)
        receipt = await client.receipt()
        after = await stored(live_note.key)
        assert receipt == AcceptedReceipt(
            "edit-1", live_note.generation, session_state(frames).epoch, 1
        )
        assert (after.revision, after.updates, after.checkpoint_seq) == (
            before.revision,
            before.updates,
            before.checkpoint_seq,
        )
        assert await live_note.stream_ids() == [b"1-0"]
        assert resident_text(manager, live_note.key) == "base typed"


async def test_duplicate_update_id_answers_the_same_sequence(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    edit = typed(live_note.base, suffix=" once")
    async with attached(manager, live_note) as (client, _):
        client.write("edit-1", edit, live_note.generation)
        first = await client.receipt()
        client.write("edit-1", edit, live_note.generation)
        assert await client.receipt() == first
        assert first.accepted_sequence == 1
        assert await live_note.stream_ids() == [b"1-0"]
        assert resident_text(manager, live_note.key) == "base once"


@pytest.mark.parametrize("resent", ["deletion", "sync_reply"])
async def test_resent_known_deletions_append_nothing(
    live_note: BufferedDocument, manager: YDocManager, resent: str
) -> None:
    edit = trimmed(live_note.base)
    holder = document(live_note.base, edit)
    # The deletion again under a new id, or a sync reply, which repeats every known deletion.
    known = edit if resent == "deletion" else holder.get_update(holder.get_state())
    async with attached(manager, live_note) as (client, _):
        client.write("edit-1", edit, live_note.generation)
        first = await client.receipt()
        client.write("again-1", known, live_note.generation)
        assert await client.receipt() == AcceptedReceipt(
            "again-1", live_note.generation, first.epoch, 1
        )
        assert await live_note.stream_ids() == [b"1-0"]

        scope = BufferScope(live_note.org, *live_note.key, first.generation, first.epoch)
        result = await checkpoint_document(live_note.buffer, scope, enqueue=live_note.jobs)
        assert result.status is CheckpointStatus.COMMITTED
        before = await stored(live_note.key)
        client.write("again-2", known, live_note.generation)
        committed, seen = await client.until(MESSAGE_COMMITTED)
        assert parse_committed_message(committed) == "again-2"
        # The new checkpoint repeats known deletions only, so no update frame precedes the answer.
        assert seen == []
        after = await stored(live_note.key)
        assert (after.revision, after.updates) == (before.revision, before.updates)
        assert await live_note.stream_ids() == []
        assert await valkey().zscore(live_note.keys.due, live_note.head.scope.member) is None
        assert resident_text(manager, live_note.key) == "ase"


async def test_reused_update_id_with_different_bytes_is_refused(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    async with attached(manager, live_note) as (client, _):
        client.write("edit-1", typed(live_note.base, suffix=" first"), live_note.generation)
        await client.receipt()
        client.write("edit-1", typed(live_note.base, suffix=" other"), live_note.generation)
        refusal, seen = await client.until(Y_MESSAGE_AUTH)
        assert denial(refusal) == (0, "update conflict")
        assert MESSAGE_ACCEPTED_RECEIPT not in kinds(seen)
        assert await live_note.stream_ids() == [b"1-0"]
        assert resident_text(manager, live_note.key) == "base first"


async def test_malformed_update_is_refused_without_closing_the_socket(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    generation = write_var_string(live_note.generation)
    async with attached(manager, live_note) as (client, _):
        for payload in (
            b"\x06",
            b"\x08\xff",
            b"\x06" + generation + b"\x01i\x02x",
            b"\x06" + generation + b"\x01i\x01x",
        ):
            client.send(payload)
            refusal, _ = await client.until(Y_MESSAGE_AUTH)
            assert denial(refusal) == (0, "invalid update")
        client.write("edit-1", typed(live_note.base, suffix=" valid"), live_note.generation)
        assert (await client.receipt()).accepted_sequence == 1
        assert client.socket.closes == []


async def test_worker_checkpoint_reaches_attached_client_as_progress(
    live_note: BufferedDocument,
) -> None:
    async with (
        routed(live_note, 1) as (manager,),
        attached(manager, live_note) as (client, frames),
    ):
        await subscribed(client, session_state(frames))
        client.write("edit-1", typed(live_note.base, suffix=" saved"), live_note.generation)
        receipt = await client.receipt()
        scope = BufferScope(live_note.org, *live_note.key, receipt.generation, receipt.epoch)
        result = await checkpoint_document(live_note.buffer, scope, enqueue=live_note.jobs)
        assert result.status is CheckpointStatus.COMMITTED
        frame, _ = await client.until(MESSAGE_CHECKPOINT_PROGRESS, covering)
        row = await stored(live_note.key)
        assert parse_checkpoint_progress_message(frame) == CheckpointProgress(
            receipt.generation, receipt.epoch, receipt.accepted_sequence, row.revision
        )
        client.sync()
        frame, _ = await client.until(MESSAGE_SESSION_STATE)
        assert parse_session_state_message(frame) == SessionState(
            receipt.generation, receipt.epoch, 1, 1, row.revision
        )


async def test_lost_control_record_sends_fresh_session_state_then_receipt_in_new_epoch(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    kept = typed(live_note.base, suffix=" kept")
    async with attached(manager, live_note) as (client, frames):
        client.write("edit-1", kept, live_note.generation)
        assert (await client.receipt()).accepted_sequence == 1
        await valkey().delete(live_note.keys.control)
        client.write("edit-2", typed(live_note.base, kept, suffix=" next"), live_note.generation)
        frame, seen = await client.until(MESSAGE_ACCEPTED_RECEIPT)
        receipt = parse_accepted_receipt_message(frame)
        fresh = session_state(seen)
        row = await stored(live_note.key)
        assert fresh.epoch not in (session_state(frames).epoch, "")
        assert fresh == SessionState(live_note.generation, fresh.epoch, 0, 0, row.revision)
        assert receipt == AcceptedReceipt("edit-2", live_note.generation, fresh.epoch, 1)
        assert row.buffer_epoch == fresh.epoch
        # The surviving record of the lost epoch moved into the checkpoint before the reset.
        assert text_of(row.updates) == "base kept"
        assert resident_text(manager, live_note.key) == "base kept next"


async def test_attach_asks_back_only_a_client_holding_updates_a_buffer_reset_lost(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    lost = typed(live_note.base, suffix=" lost")
    async with attached(manager, live_note) as (writer, _):
        writer.write("edit-1", lost, live_note.generation)
        assert (await writer.receipt()).accepted_sequence == 1
    await evicted(manager, live_note.key)
    await valkey().delete(live_note.keys.control, live_note.keys.stream)

    # A peer that received the edit before the buffer lost it reconnects still holding it.
    holder = connect(manager, live_note.key, live_note.org, live_note.owner)
    holder.doc = document(live_note.base, lost)
    holder.sync()
    _, frames = await holder.until(YMessageType.SYNC, step(YSyncMessageType.SYNC_STEP2))
    assert kinds(frames) == [MESSAGE_GENERATION, MESSAGE_SESSION_STATE, YMessageType.SYNC]
    fresh = session_state(frames)
    assert fresh.epoch != live_note.head.scope.epoch
    assert resident_text(manager, live_note.key) == "base"

    asked = sync_step1_state_vector(frames[2])
    holder.write("restore-1", holder.doc.get_update(asked), live_note.generation)
    assert await holder.receipt() == AcceptedReceipt(
        "restore-1", live_note.generation, fresh.epoch, 1
    )
    assert resident_text(manager, live_note.key) == "base lost"

    in_sync = connect(manager, live_note.key, live_note.org, live_note.owner)
    in_sync.doc = document(live_note.base, lost)
    in_sync.sync()
    _, again = await in_sync.until(YMessageType.SYNC, step(YSyncMessageType.SYNC_STEP2))
    assert kinds(again) == [MESSAGE_GENERATION, MESSAGE_SESSION_STATE]
    await in_sync.leave()
    await holder.leave()


async def test_progress_for_a_retired_epoch_reaches_no_client(live_note: BufferedDocument) -> None:
    async with (
        routed(live_note, 1) as (manager,),
        attached(manager, live_note) as (client, frames),
    ):
        await subscribed(client, session_state(frames))
        kept = typed(live_note.base, suffix=" kept")
        client.write("edit-1", kept, live_note.generation)
        retired = await client.receipt()
        await valkey().delete(live_note.keys.control)
        client.write("edit-2", typed(live_note.base, kept, suffix=" next"), live_note.generation)
        frame, seen = await client.until(MESSAGE_ACCEPTED_RECEIPT)
        fresh = parse_accepted_receipt_message(frame)
        assert fresh.epoch != retired.epoch
        # The reset announces the fresh epoch; take that frame before the stale one is sent.
        if not any(announces(fresh.epoch)(payload) for payload in seen):
            await client.until(MESSAGE_CHECKPOINT_PROGRESS, announces(fresh.epoch))
        row = await stored(live_note.key)

        for receipt, covered in ((retired, 1), (fresh, 0)):
            await publish_checkpoint_progress(
                *live_note.key,
                generation=receipt.generation,
                epoch=receipt.epoch,
                covered_sequence=covered,
                checkpoint_revision=row.revision,
            )
        frame, seen = await client.until(MESSAGE_CHECKPOINT_PROGRESS)
        assert parse_checkpoint_progress_message(frame).epoch == fresh.epoch
        assert MESSAGE_CHECKPOINT_PROGRESS not in kinds(seen)
        client.sync()
        frame, _ = await client.until(MESSAGE_SESSION_STATE)
        assert parse_session_state_message(frame) == SessionState(
            fresh.generation, fresh.epoch, 1, 0, row.revision
        )


@pytest.mark.parametrize("revision", ["advanced", "already_known"])
async def test_progress_ahead_of_a_missed_hint_reloads_the_record_before_announcing_it(
    live_note: BufferedDocument, revision: str
) -> None:
    async with (
        routed(live_note, 2) as (left, right),
        attached(left, live_note) as (author, _),
        attached(right, live_note) as (reader, reader_frames),
    ):
        state = session_state(reader_frames)
        await subscribed(author, state)
        await subscribed(reader, state)
        await right.realtime_router.stop()
        author.write("edit-1", typed(live_note.base, suffix=" one"), live_note.generation)
        receipt = await author.receipt()
        scope = BufferScope(live_note.org, *live_note.key, receipt.generation, receipt.epoch)
        result = await checkpoint_document(live_note.buffer, scope, enqueue=live_note.jobs)
        assert result.status is CheckpointStatus.COMMITTED
        await right.realtime_router.start()
        await subscribed(reader, state)
        assert resident_text(right, live_note.key) == "base"

        row = await stored(live_note.key)
        announced = row.revision if revision == "advanced" else state.checkpoint_revision
        await publish_checkpoint_progress(
            *live_note.key,
            generation=receipt.generation,
            epoch=receipt.epoch,
            covered_sequence=1,
            checkpoint_revision=announced,
        )
        frame, _ = await reader.until(MESSAGE_CHECKPOINT_PROGRESS, covering)
        assert parse_checkpoint_progress_message(frame) == CheckpointProgress(
            receipt.generation, receipt.epoch, 1, announced
        )
        assert reader.markdown == "base one"
        assert resident_text(right, live_note.key) == "base one"


async def test_epoch_reset_on_one_replica_moves_the_clients_of_another(
    live_note: BufferedDocument,
) -> None:
    async with (
        routed(live_note, 2) as (left, right),
        attached(left, live_note) as (author, _),
        attached(right, live_note) as (reader, reader_frames),
    ):
        state = session_state(reader_frames)
        await subscribed(author, state)
        await subscribed(reader, state)
        await valkey().delete(live_note.keys.control)
        # A resync reads the lost epoch and resets it without appending anything.
        author.sync()
        frame, _ = await author.until(
            MESSAGE_SESSION_STATE,
            lambda payload: parse_session_state_message(payload).epoch != state.epoch,
        )
        fresh = parse_session_state_message(frame)
        frame, seen = await reader.until(MESSAGE_CHECKPOINT_PROGRESS, announces(fresh.epoch))
        assert parse_checkpoint_progress_message(frame) == CheckpointProgress(
            fresh.generation, fresh.epoch, 0, fresh.checkpoint_revision
        )
        assert session_state(seen) == fresh
        assert seen[-1][:2] == bytes([YMessageType.SYNC, YSyncMessageType.SYNC_STEP1])


async def test_disabled_buffering_refuses_as_unavailable_and_keeps_resident(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    async with attached(manager, live_note) as (client, _):
        async with buffering_disabled():
            client.write("edit-1", typed(live_note.base, suffix=" refused"), live_note.generation)
            refusal, seen = await client.until(Y_MESSAGE_AUTH)
        assert denial(refusal) == (0, UNAVAILABLE)
        assert MESSAGE_ACCEPTED_RECEIPT not in kinds(seen)
        assert await live_note.stream_ids() == []
        assert resident_text(manager, live_note.key) == "base"


async def test_unreachable_buffer_refuses_as_unavailable_and_keeps_resident(
    live_note: BufferedDocument,
) -> None:
    async with unreachable(live_note.namespace) as buffer:
        manager = replica(buffer)
        async with attached(manager, live_note) as (client, frames):
            # Without a readable buffer the checkpoint alone seeds the document, without epoch.
            assert MESSAGE_SESSION_STATE not in kinds(frames)
            client.write("edit-1", typed(live_note.base, suffix=" refused"), live_note.generation)
            refusal, seen = await client.until(Y_MESSAGE_AUTH)
            assert denial(refusal) == (0, UNAVAILABLE)
            assert MESSAGE_ACCEPTED_RECEIPT not in kinds(seen)
            assert resident_text(manager, live_note.key) == "base"
        await evicted(manager, live_note.key)
    assert await live_note.stream_ids() == []


async def test_replicas_converge_through_pubsub_and_repair_missed_hints(
    live_note: BufferedDocument,
) -> None:
    generation = live_note.generation
    async with (
        routed(live_note, 2) as (left, right),
        attached(left, live_note) as (author, author_frames),
        attached(right, live_note) as (reader, reader_frames),
    ):
        right_router = right.realtime_router
        state = session_state(reader_frames)
        assert session_state(author_frames) == state
        await subscribed(author, state)
        await subscribed(reader, state)
        before = await stored(live_note.key)

        one = typed(live_note.base, suffix=" one")
        author.write("edit-1", one, generation)
        await author.receipt()
        await reader.text("base one")
        assert resident_text(right, live_note.key) == "base one"

        # A hint the reader's replica never sees leaves a gap the next hint exposes.
        await right_router.stop()
        two = typed(live_note.base, one, suffix=" two")
        author.write("edit-2", two, generation)
        await author.receipt()
        await right_router.start()
        await subscribed(reader, state)
        three = typed(live_note.base, one, two, suffix=" three")
        author.write("edit-3", three, generation)
        await author.receipt()
        await reader.text("base one two three")

        # With every hint withheld and the author gone, the periodic resync repairs.
        await right_router.stop()
        four = typed(live_note.base, one, two, three, suffix=" four")
        author.write("edit-4", four, generation)
        assert (await author.receipt()).accepted_sequence == 4
        await author.leave()
        reader.sync()
        frame, _ = await reader.until(MESSAGE_SESSION_STATE)
        assert parse_session_state_message(frame).head_sequence == 4
        await reader.until(YMessageType.SYNC, step(YSyncMessageType.SYNC_STEP2))
        assert reader.markdown == "base one two three four"
        assert resident_text(right, live_note.key) == "base one two three four"
        after = await stored(live_note.key)
        assert (after.revision, after.updates) == (before.revision, before.updates)


async def test_eviction_with_pending_tail_keeps_scheduled_work_without_snapshot_write(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    before = await stored(live_note.key)
    async with attached(manager, live_note) as (client, _):
        client.write("edit-1", typed(live_note.base, suffix=" pending"), live_note.generation)
        await client.receipt()
    await evicted(manager, live_note.key)

    after = await stored(live_note.key)
    assert (after.revision, after.updates, after.checkpoint_seq) == (
        before.revision,
        before.updates,
        before.checkpoint_seq,
    )
    assert await live_note.stream_ids() == [b"1-0"]
    assert await valkey().zscore(live_note.keys.due, live_note.head.scope.member) is not None


async def test_hydrating_one_document_does_not_hold_up_another(
    live_note: BufferedDocument, manager: YDocManager, access: Any
) -> None:
    other = await buffered((ContentType.NOTE, access.private_note_id), access, live_note.namespace)
    try:
        async with open_session() as db:
            # Hydration takes the document lock, so this transaction holds the other attach.
            await lock_document(db, other.key, other.org)
            waiting = asyncio.create_task(attach(manager, other))
            await asyncio.sleep(QUIET_SECONDS)
            async with attached(manager, live_note) as (client, _):
                assert client.markdown == "base"
            assert not waiting.done()
            await db.rollback()
        late, _ = await asyncio.wait_for(waiting, FRAME_TIMEOUT)
        await late.leave()
        await evicted(manager, other.key)
    finally:
        await discard(other.key)
