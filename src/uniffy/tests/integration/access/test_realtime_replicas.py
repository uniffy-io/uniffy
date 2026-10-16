"""Two resident replicas share accepted edits and revocations through real Valkey pubsub."""

import asyncio
from typing import Any

import pytest

from uniffy.core.models.notes.note import Note
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.adapter import get_realtime_adapter, register_realtime_adapter
from uniffy.core.realtime.buffer_keys import BufferScope
from uniffy.core.realtime.checkpoint import CheckpointStatus, checkpoint_document
from uniffy.core.realtime.job_contracts import SAVE_REALTIME_SNAPSHOT
from uniffy.core.realtime.jobs import recover_realtime_projections, save_realtime_snapshot
from uniffy.core.realtime.wire import (
    MESSAGE_CHECKPOINT_PROGRESS,
    MESSAGE_SESSION_STATE,
    Y_MESSAGE_AUTH,
    CheckpointProgress,
    YMessageType,
    YSyncMessageType,
    parse_checkpoint_progress_message,
    parse_session_state_message,
)
from uniffy.core.types import ContentRole, ContentType
from uniffy.infrastructure.database.session import open_session
from uniffy.tests.integration.access.realtime_live import (
    BufferedDocument,
    live_note,  # noqa: F401 - fixture
    stored,
    text_of,
    typed,
)
from uniffy.tests.integration.access.test_realtime_live_routing import (
    FRAME_TIMEOUT,
    Client,
    attach,
    denial,
    evicted,
    kinds,
    resident_text,
    routed,
    session_state,
    step,
    subscribed,
)
from uniffy.tests.integration.access.test_realtime_parity import (
    SharedDocument,
    buffer,  # noqa: F401 - fixture
    make_private,
    share,
    shared,  # noqa: F401 - fixture
    text,
    unshare,
    without_job_queues,  # noqa: F401 - fixture
    write_own,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")

RECOVERY_PASSES = 20


def checkpoint_of(row: RealtimeYjsSnapshot) -> tuple:
    return (row.revision, row.updates, row.checkpoint_seq, row.buffer_epoch)


async def holding(client: Client, *words: str) -> str:
    """The client's text once every word has reached it."""
    async with asyncio.timeout(FRAME_TIMEOUT):
        while not all(word in text(client) for word in words):
            await client.receive()
    return text(client)


async def test_writers_on_two_replicas_converge_before_any_checkpoint(
    shared: SharedDocument,
) -> None:
    doc = shared.doc
    await share(shared, ContentRole.EDITOR)
    before = await stored(doc.key)
    async with routed(doc.buffer, 2) as (left, right):
        alice, alice_frames = await attach(left, doc)
        bob, bob_frames = await attach(right, doc, doc.peer)
        try:
            state = session_state(bob_frames)
            assert session_state(alice_frames) == state
            await subscribed(alice, state)
            await subscribed(bob, state)

            # Both edits leave before either replica has seen the other's.
            write_own(alice, "alice-1", typed(doc.base, suffix=" alice"), doc.generation)
            write_own(bob, "bob-1", typed(doc.base, suffix=" bob"), doc.generation)
            sequences = {(await alice.receipt()).accepted_sequence}
            sequences.add((await bob.receipt()).accepted_sequence)

            assert sequences == {1, 2}
            converged = await holding(alice, "alice", "bob")
            assert await holding(bob, "alice", "bob") == converged
            assert resident_text(left, doc.key) == converged
            assert resident_text(right, doc.key) == converged
            assert await doc.stream_ids() == [b"1-0", b"2-0"]
            assert checkpoint_of(await stored(doc.key)) == checkpoint_of(before)
        finally:
            await bob.leave()
            await alice.leave()
            await evicted(left, doc.key)
            await evicted(right, doc.key)


async def test_dropped_hint_is_repaired_by_resync_before_any_checkpoint(
    shared: SharedDocument,
) -> None:
    doc = shared.doc
    await share(shared, ContentRole.VIEWER)
    before = await stored(doc.key)
    async with routed(doc.buffer, 2) as (left, right):
        author, frames = await attach(left, doc)
        reader, _ = await attach(right, doc, doc.peer)
        try:
            state = session_state(frames)
            await subscribed(author, state)
            await subscribed(reader, state)

            await right.realtime_router.stop()
            one = typed(doc.base, suffix=" one")
            author.write("edit-1", one, doc.generation)
            assert (await author.receipt()).accepted_sequence == 1
            assert YMessageType.SYNC not in kinds(await reader.drain())
            assert text(reader) == "base"

            # The reader's periodic SyncStep1 compares heads with the buffer on its own replica.
            reader.sync()
            frame, _ = await reader.until(MESSAGE_SESSION_STATE)
            assert parse_session_state_message(frame).head_sequence == 1
            await reader.until(YMessageType.SYNC, step(YSyncMessageType.SYNC_STEP2))
            assert text(reader) == "base one"
            assert resident_text(right, doc.key) == "base one"

            await right.realtime_router.start()
            await subscribed(reader, state)
            author.write("edit-2", typed(doc.base, one, suffix=" two"), doc.generation)
            assert (await author.receipt()).accepted_sequence == 2
            await reader.text("base one two")
            assert checkpoint_of(await stored(doc.key)) == checkpoint_of(before)
        finally:
            await reader.leave()
            await author.leave()
            await evicted(left, doc.key)
            await evicted(right, doc.key)


@pytest.mark.parametrize("revocation", ["member_removed", "made_private"])
async def test_revocation_published_on_one_replica_stops_disclosure_on_the_other(
    shared: SharedDocument, revocation: str
) -> None:
    doc = shared.doc
    await share(shared, ContentRole.EDITOR)
    async with routed(doc.buffer, 2) as (left, right):
        author, frames = await attach(left, doc)
        observer, _ = await attach(right, doc)
        editor, _ = await attach(right, doc, doc.peer)
        try:
            state = session_state(frames)
            await subscribed(author, state)
            await subscribed(editor, state)
            one = typed(doc.base, suffix=" one")
            author.write("edit-1", one, doc.generation)
            await author.receipt()
            await editor.text("base one")
            await observer.text("base one")

            if revocation == "made_private":
                # A content-wide change: for a task it is published on the project's channel.
                await make_private(shared)
            else:
                await unshare(shared)
            # Nothing else moves on either replica; the published revocation alone detaches it.
            refusal, seen = await editor.until(Y_MESSAGE_AUTH)
            assert denial(refusal) == (1, "access revoked")
            assert YMessageType.SYNC not in kinds(seen)

            author.write("edit-2", typed(doc.base, one, suffix=" two"), doc.generation)
            assert (await author.receipt()).accepted_sequence == 2
            await observer.text("base one two")
            editor.write("edit-3", typed(doc.base, one, suffix=" three"), doc.generation)
            assert await editor.drain() == []
            assert text(editor) == "base one"
            assert resident_text(right, doc.key) == "base one two"
            assert await doc.stream_ids() == [b"1-0", b"2-0"]
            assert editor.socket.closes == []
        finally:
            await editor.leave()
            await observer.leave()
            await author.leave()
            await evicted(left, doc.key)
            await evicted(right, doc.key)


class RenderFailed(Exception):
    pass


class _RenderOutage:
    """The registered note adapter, except that projection rendering fails."""

    def __init__(self, inner: Any) -> None:
        self._inner = inner
        self.content_type = inner.content_type

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    async def stage_render(self, *args: Any, **kwargs: Any) -> None:
        raise RenderFailed("renderer unavailable")


async def note_content(note: BufferedDocument) -> str | None:
    async with open_session() as db:
        row = await db.get(Note, note.key[1])
    assert row is not None
    return row.content


async def projected(note: BufferedDocument) -> RealtimeYjsSnapshot:
    """Run the projection recovery sweep until it has rendered the note's checkpoint."""
    for _ in range(RECOVERY_PASSES):
        await recover_realtime_projections({})
        row = await stored(note.key)
        if row.rendered_revision == row.revision and not row.effects_pending:
            return row
    raise AssertionError("projection recovery never rendered the checkpoint")


async def test_projection_failure_after_worker_checkpoint_keeps_coverage_and_recovers(
    live_note: BufferedDocument,  # noqa: F811 - fixture
) -> None:
    note = live_note
    adapter = get_realtime_adapter(ContentType.NOTE)
    register_realtime_adapter(_RenderOutage(adapter))
    try:
        async with routed(note.buffer, 1) as (manager,):
            client, frames = await attach(manager, note)
            try:
                await subscribed(client, session_state(frames))
                one = typed(note.base, suffix=" one")
                client.write("edit-1", one, note.generation)
                client.write("edit-2", typed(note.base, one, suffix=" two"), note.generation)
                await client.receipt()
                receipt = await client.receipt()
                assert receipt.accepted_sequence == 2
                scope = BufferScope(note.org, *note.key, receipt.generation, receipt.epoch)

                result = await checkpoint_document(note.buffer, scope, enqueue=note.jobs)

                assert (result.status, result.covered) == (CheckpointStatus.COMMITTED, 2)
                frame, _ = await client.until(
                    MESSAGE_CHECKPOINT_PROGRESS,
                    lambda payload: parse_checkpoint_progress_message(payload).covered_sequence > 0,
                )
                row = await stored(note.key)
                assert parse_checkpoint_progress_message(frame) == CheckpointProgress(
                    receipt.generation, receipt.epoch, 2, row.revision
                )
                assert text_of(row.updates) == "base one two"

                # The worker's projection job runs after the commit and its renderer fails.
                [(name, _, args)] = note.jobs.jobs
                assert name == SAVE_REALTIME_SNAPSHOT.name
                with pytest.raises(RenderFailed):
                    await save_realtime_snapshot({}, *args)
                await recover_realtime_projections({})
                row = await stored(note.key)
                assert row.rendered_revision < row.revision
                assert text_of(row.updates) == "base one two"
                assert await note_content(note) == "base"
            finally:
                await client.leave()
                await evicted(manager, note.key)
    finally:
        register_realtime_adapter(adapter)

    row = await projected(note)
    assert await note_content(note) == "base one two"
    assert row.checkpoint_seq == 2
    assert await note.stream_ids() == []
