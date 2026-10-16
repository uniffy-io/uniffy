"""Resident replicas share accepted edits, revocations, reload hints and the fragment seed lease."""

import base64
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import update

from uniffy.core.models.notes.note import Note
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime import storage
from uniffy.core.realtime.adapter import get_realtime_adapter, register_realtime_adapter
from uniffy.core.realtime.buffer_keys import BufferScope
from uniffy.core.realtime.checkpoint import CheckpointStatus, checkpoint_document
from uniffy.core.realtime.job_contracts import PROJECT_REALTIME_DOCUMENT
from uniffy.core.realtime.jobs import project_realtime_document, recover_realtime_projections
from uniffy.core.realtime.multiplex import read_var_string
from uniffy.core.realtime.publisher import RealtimePayloadKind, publish_content_replace
from uniffy.core.realtime.wire import (
    MESSAGE_CHECKPOINT_PROGRESS,
    MESSAGE_COMMITTED,
    MESSAGE_FRAGMENT_SEEDER,
    MESSAGE_SEED_CAPABILITY,
    MESSAGE_SESSION_STATE,
    Y_MESSAGE_AUTH,
    CheckpointProgress,
    YMessageType,
    YSyncMessageType,
    parse_checkpoint_progress_message,
    parse_committed_message,
    parse_session_state_message,
)
from uniffy.core.realtime.ydoc_manager import YDocManager
from uniffy.core.types import ContentRole, ContentType, generate_id
from uniffy.infrastructure.database.session import open_session
from uniffy.tests.integration.access.realtime_buffers import gauge
from uniffy.tests.integration.access.realtime_documents import (
    SharedDocument,
    make_private,
    share,
    unshare,
)
from uniffy.tests.integration.access.realtime_live import (
    BufferedDocument,
    buffering_disabled,
    channel_messages,
    fragment_edit,
    fragment_of,
    live_note,  # noqa: F401 - fixture
    published,
    stored,
    text_of,
    typed,
)
from uniffy.tests.integration.access.realtime_sockets import (
    Client,
    attached,
    denial,
    evicted,
    kinds,
    replica,
    resident_text,
    routed,
    seed_proposal,
    session_state,
    step,
    subscribed,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")

RECOVERY_PASSES = 20
UNSEAL_FAILURES = "uniffy_realtime_buffer_unseal_failures_total"


def checkpoint_of(row: RealtimeYjsSnapshot) -> tuple:
    return (row.revision, row.updates, row.checkpoint_seq, row.buffer_epoch)


@pytest_asyncio.fixture(loop_scope="session")
async def manager(live_note: BufferedDocument) -> AsyncIterator[YDocManager]:
    manager = replica(live_note.buffer)
    yield manager
    await manager.drain_for_shutdown()
    await evicted(manager, live_note.key)


async def test_writers_on_two_replicas_converge_before_any_checkpoint(
    shared: SharedDocument,
) -> None:
    doc = shared.doc
    await share(shared, ContentRole.EDITOR)
    before = await stored(doc.key)
    async with (
        routed(doc, 2) as (left, right),
        attached(left, doc) as (alice, alice_frames),
        attached(right, doc, doc.peer) as (bob, bob_frames),
    ):
        state = session_state(bob_frames)
        assert session_state(alice_frames) == state
        await subscribed(alice, state)
        await subscribed(bob, state)

        # Both edits leave before either replica has seen the other's.
        alice.write_own("alice-1", typed(doc.base, suffix=" alice"), doc.generation)
        bob.write_own("bob-1", typed(doc.base, suffix=" bob"), doc.generation)
        sequences = {(await alice.receipt()).accepted_sequence}
        sequences.add((await bob.receipt()).accepted_sequence)

        assert sequences == {1, 2}
        converged = await alice.holding("alice", "bob")
        assert await bob.holding("alice", "bob") == converged
        assert resident_text(left, doc.key) == converged
        assert resident_text(right, doc.key) == converged
        assert await doc.stream_ids() == [b"1-0", b"2-0"]
        assert checkpoint_of(await stored(doc.key)) == checkpoint_of(before)


async def test_peer_hints_carry_only_sealed_records_that_the_other_replica_opens(
    shared: SharedDocument,
) -> None:
    doc = shared.doc
    await share(shared, ContentRole.EDITOR)
    failures = gauge(UNSEAL_FAILURES, {"source": "remote"})
    async with (
        routed(doc, 2) as (left, right),
        attached(left, doc) as (alice, frames),
        attached(right, doc, doc.peer) as (bob, _),
    ):
        state = session_state(frames)
        await subscribed(alice, state)
        await subscribed(bob, state)

        async with channel_messages(doc.key) as channel:
            alice.write_own("alice-1", typed(doc.base, suffix=" confidential"), doc.generation)
            assert (await alice.receipt()).accepted_sequence == 1
            await bob.holding("confidential")
            hints = [
                payload
                for payload in await published(channel)
                if payload.get("kind") == RealtimePayloadKind.ACCEPTED_UPDATE
            ]

        assert resident_text(right, doc.key) == bob.markdown
    (hint,) = hints
    sealed = base64.b64decode(hint["sealed"])
    assert "update" not in hint
    assert (hint["sequence"], hint["update_id"], hint["actor_id"]) == (1, "alice-1", str(doc.owner))
    assert sealed[0] == 0x01
    assert b"confidential" not in sealed
    # The peer opened the hint itself; a record that failed to open would reload the tail.
    assert gauge(UNSEAL_FAILURES, {"source": "remote"}) == failures


async def test_dropped_hint_is_repaired_by_resync_before_any_checkpoint(
    shared: SharedDocument,
) -> None:
    doc = shared.doc
    await share(shared, ContentRole.VIEWER)
    before = await stored(doc.key)
    async with (
        routed(doc, 2) as (left, right),
        attached(left, doc) as (author, frames),
        attached(right, doc, doc.peer) as (reader, _),
    ):
        state = session_state(frames)
        await subscribed(author, state)
        await subscribed(reader, state)

        await right.realtime_router.stop()
        one = typed(doc.base, suffix=" one")
        author.write("edit-1", one, doc.generation)
        assert (await author.receipt()).accepted_sequence == 1
        assert YMessageType.SYNC not in kinds(await reader.drain())
        assert reader.markdown == "base"

        # The reader's periodic SyncStep1 compares heads with the buffer on its own replica.
        reader.sync()
        frame, _ = await reader.until(MESSAGE_SESSION_STATE)
        assert parse_session_state_message(frame).head_sequence == 1
        await reader.until(YMessageType.SYNC, step(YSyncMessageType.SYNC_STEP2))
        assert reader.markdown == "base one"
        assert resident_text(right, doc.key) == "base one"

        await right.realtime_router.start()
        await subscribed(reader, state)
        author.write("edit-2", typed(doc.base, one, suffix=" two"), doc.generation)
        assert (await author.receipt()).accepted_sequence == 2
        await reader.text("base one two")
        assert checkpoint_of(await stored(doc.key)) == checkpoint_of(before)


@pytest.mark.parametrize("revocation", ["member_removed", "made_private"])
async def test_revocation_published_on_one_replica_stops_disclosure_on_the_other(
    shared: SharedDocument, revocation: str
) -> None:
    doc = shared.doc
    await share(shared, ContentRole.EDITOR)
    async with (
        routed(doc, 2) as (left, right),
        attached(left, doc) as (author, frames),
        attached(right, doc) as (observer, _),
        attached(right, doc, doc.peer) as (editor, _),
    ):
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
        assert editor.markdown == "base one"
        assert resident_text(right, doc.key) == "base one two"
        assert await doc.stream_ids() == [b"1-0", b"2-0"]
        assert editor.socket.closes == []


async def test_content_replace_hint_reloads_checkpoint_and_tail(
    live_note: BufferedDocument,
) -> None:
    elsewhere = (ContentType.NOTE, generate_id())
    async with routed(live_note, 1) as (manager,):
        # A hint for a document this replica does not hold hydrates nothing.
        await publish_content_replace(*elsewhere)
        async with attached(manager, live_note) as (client, frames):
            await subscribed(client, session_state(frames))
            assert manager.resident(elsewhere) is None
            # Another replica admitted this edit; no update hint reaches this one.
            await live_note.admit("edit-1", typed(live_note.base, suffix=" buffered"))

            await publish_content_replace(*live_note.key)

            await client.text("base buffered")
            assert resident_text(manager, live_note.key) == "base buffered"


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
        await recover_realtime_projections({}, organization_id=note.org)
        row = await stored(note.key)
        if row.rendered_revision == row.revision and not row.effects_pending:
            return row
    raise AssertionError("projection recovery never rendered the checkpoint")


async def test_projection_failure_after_worker_checkpoint_keeps_coverage_and_recovers(
    live_note: BufferedDocument,
) -> None:
    note = live_note
    adapter = get_realtime_adapter(ContentType.NOTE)
    register_realtime_adapter(_RenderOutage(adapter))
    try:
        async with routed(note, 1) as (manager,), attached(manager, note) as (client, frames):
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
            assert name == PROJECT_REALTIME_DOCUMENT.name
            with pytest.raises(RenderFailed):
                await project_realtime_document({}, *args)
            await recover_realtime_projections({}, organization_id=note.org)
            row = await stored(note.key)
            assert row.rendered_revision < row.revision
            assert text_of(row.updates) == "base one two"
            assert await note_content(note) == "base"
    finally:
        register_realtime_adapter(adapter)

    row = await projected(note)
    assert await note_content(note) == "base one two"
    assert row.checkpoint_seq == 2
    assert await note.stream_ids() == []


async def advertise(client: Client, capable: bool) -> list[bytes]:
    """Send the seed capability, then a sync as a barrier; frames received before its reply."""
    client.send(bytes([MESSAGE_SEED_CAPABILITY, int(capable)]))
    client.sync()
    _, frames = await client.until(YMessageType.SYNC, step(YSyncMessageType.SYNC_STEP2))
    return frames


def seeder_frames(frames: list[bytes]) -> list[int]:
    return [frame[1] for frame in frames if frame[0] == MESSAGE_FRAGMENT_SEEDER]


async def test_seed_proposal_commits_with_the_buffered_tail_and_answers_committed(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    # Longer than the 4 KiB identifier cap, so the source string uses the frame limit.
    source = "base" + "é" * 3000
    grown = typed(live_note.base, suffix=source[4:])
    async with attached(manager, live_note) as (client, _):
        client.write("edit-1", grown, live_note.generation)
        await client.receipt()
        client.send(bytes([MESSAGE_SEED_CAPABILITY, 1]))
        grant, _ = await client.until(MESSAGE_FRAGMENT_SEEDER, lambda payload: payload[1] == 1)
        token, _ = read_var_string(grant, 2)
        proposal = fragment_edit(live_note.base, grown, text=source, claim="client")
        client.send(seed_proposal(live_note.generation, "seed-1", token, source, proposal))
        committed, _ = await client.until(MESSAGE_COMMITTED)
        row = await stored(live_note.key)
        assert parse_committed_message(committed) == "seed-1"
        assert source in fragment_of(row.updates)
        assert text_of(row.updates) == source
        assert row.checkpoint_seq == 1


async def test_seed_role_goes_to_one_capable_client_once(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    async with (
        attached(manager, live_note) as (first, _),
        attached(manager, live_note) as (second, _),
    ):
        assert seeder_frames(await advertise(first, capable=True)) == [1]
        assert seeder_frames(await advertise(second, capable=True)) == []
        assert seeder_frames(await first.drain()) == []


async def test_live_lease_on_another_replica_keeps_local_clients_waiting(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    async with open_session() as db:
        await db.execute(
            update(RealtimeYjsSnapshot)
            .where(RealtimeYjsSnapshot.content_id == live_note.key[1])
            .values(seed_owner="other:1", seed_expires_at=datetime.now(UTC) + timedelta(minutes=1))
        )
        await db.commit()
    async with attached(manager, live_note) as (client, _):
        assert seeder_frames(await advertise(client, capable=True)) == []
        assert (await stored(live_note.key)).seed_owner == "other:1"


async def test_plain_clients_never_claim_the_seed_lease(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    async with attached(manager, live_note) as (client, _):
        client.write("edit-1", typed(live_note.base, suffix=" plain"), live_note.generation)
        await client.receipt()
        assert seeder_frames(await client.drain()) == []
        assert (await stored(live_note.key)).seed_owner is None


async def test_withdrawn_capability_hands_the_seed_role_over(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    async with (
        attached(manager, live_note) as (first, _),
        attached(manager, live_note) as (second, _),
    ):
        assert seeder_frames(await advertise(first, capable=True)) == [1]
        assert seeder_frames(await advertise(second, capable=True)) == []
        assert seeder_frames(await advertise(first, capable=False)) == [0]
        grant, _ = await second.until(MESSAGE_FRAGMENT_SEEDER)
        assert grant[1] == 1


async def test_expired_seed_lease_moves_without_client_traffic(
    live_note: BufferedDocument, manager: YDocManager, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(storage, "SEED_LEASE", timedelta(seconds=1))
    async with (
        attached(manager, live_note) as (first, _),
        attached(manager, live_note) as (second, _),
    ):
        assert seeder_frames(await advertise(first, capable=True)) == [1]
        assert seeder_frames(await advertise(second, capable=True)) == []
        grant, _ = await second.until(MESSAGE_FRAGMENT_SEEDER)
        revoke, _ = await first.until(MESSAGE_FRAGMENT_SEEDER)
        assert (grant[1], revoke[1]) == (1, 0)


async def test_unverifiable_seed_election_does_not_block_release(
    live_note: BufferedDocument, manager: YDocManager
) -> None:
    async with attached(manager, live_note) as (client, _):
        assert seeder_frames(await advertise(client, capable=True)) == [1]
        async with buffering_disabled():
            await client.leave()
            await evicted(manager, live_note.key)
    assert client.task.exception() is None
