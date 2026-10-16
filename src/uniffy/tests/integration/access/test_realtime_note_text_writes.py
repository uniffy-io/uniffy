"""Ordinary note text writes merge into live state and commit the buffered tail they cover."""

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from uniffy_proto.notes.v1.notes_pb import UpdateNoteRequest, UpdateNoteResponse

from uniffy.core.auth.principal import (
    AuthenticatedPrincipal,
    reset_current_principal,
    set_current_principal,
)
from uniffy.core.errors import StaleContentVersionError
from uniffy.core.models.notes.note import Note
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.realtime.checkpoint import CheckpointStatus, checkpoint_document
from uniffy.core.realtime.live import load_live_document
from uniffy.core.realtime.snapshot import SnapshotOutcome, persist_snapshot
from uniffy.core.realtime.storage import lock_document
from uniffy.core.search.indexer import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.domains.notes.content.updates import NoteUpdates
from uniffy.domains.notes.operations import NoteOperations
from uniffy.domains.notes.service import NotesServiceImpl
from uniffy.infrastructure.database.session import open_session
from uniffy.tests.integration.access.realtime_live import (
    BufferedDocument,
    doc_messages,  # noqa: F401 - fixture
    live_note,  # noqa: F401 - fixture
    published_progress,
    stored,
    text_of,
    typed,
    unreachable_buffer,  # noqa: F401 - fixture
)

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def update_note(
    note: BufferedDocument, buffer: UpdateBuffer, **fields: Any
) -> UpdateNoteResponse:
    """Call the UpdateNote RPC as the note's owner, against ``buffer``."""
    service = NotesServiceImpl(MagicMock(spec=ObjectStorage), AsyncMock(spec=SearchIndexer))
    service.buffer = buffer
    request = UpdateNoteRequest(note_id=str(note.key[1]), organization_id=str(note.org), **fields)
    token = set_current_principal(
        AuthenticatedPrincipal(
            user_id=note.owner,
            organization_id=note.org,
            session_id=None,
            token_version=None,
            full_name="",
            avatar_key="",
        )
    )
    try:
        return await service.update_note(request, MagicMock())
    finally:
        reset_current_principal(token)


async def note_row(note: BufferedDocument) -> Note:
    async with open_session() as db:
        row = await db.get(Note, note.key[1])
    assert row is not None
    return row


async def unchanged(note: BufferedDocument) -> tuple[Any, ...]:
    """The committed note, checkpoint and buffer, for comparing before and after a write."""
    row, snapshot = await note_row(note), await stored(note.key)
    return (
        (row.title, row.content, row.version),
        (
            snapshot.updates,
            snapshot.revision,
            snapshot.rendered_revision,
            snapshot.checkpoint_seq,
            snapshot.buffer_epoch,
        ),
        await note.buffer_state(),
    )


async def test_text_rpc_commits_the_buffered_tail_and_announces_progress_covering_it(
    live_note: BufferedDocument, doc_messages
) -> None:
    alice = typed(live_note.base, suffix=" Alice")
    await live_note.admit("u-alice", alice)
    bob = await live_note.admit("u-bob", typed(live_note.base, alice, suffix=" Bob"), live_note.peer)
    before, version = await stored(live_note.key), (await note_row(live_note)).version

    response = await update_note(
        live_note, live_note.buffer, content="base agent", base_content="base"
    )

    assert response.note.content == "base Alice Bob agent"
    note = await note_row(live_note)
    assert (note.content, note.version) == ("base Alice Bob agent", version + 1)
    row = await stored(live_note.key)
    assert text_of(row.updates) == note.content
    assert (row.generation, row.buffer_epoch, row.checkpoint_seq) == (
        live_note.generation,
        live_note.head.scope.epoch,
        bob,
    )
    assert row.revision == row.rendered_revision == before.revision + 1
    assert row.actor_id == live_note.owner
    assert await live_note.buffer_state() == {
        "stream": [],
        "control": 1,
        "receipts": [],
        "due": None,
    }
    # Bob holds only an accepted receipt; this progress is what moves him to saved.
    assert await published_progress(doc_messages) == [
        {
            "generation": live_note.generation,
            "epoch": live_note.head.scope.epoch,
            "covered_sequence": bob,
            "checkpoint_revision": row.revision,
        }
    ]


async def test_stale_base_clear_keeps_text_that_only_the_buffered_tail_holds(
    live_note: BufferedDocument,
) -> None:
    await live_note.admit("u-alice", typed(live_note.base, suffix=" Alice"), live_note.peer)

    response = await update_note(live_note, live_note.buffer, content="", base_content="base")

    assert response.note.content == " Alice"
    row = await stored(live_note.key)
    assert text_of(row.updates) == " Alice"
    assert (row.checkpoint_seq, row.rendered_revision) == (1, row.revision)
    assert (await live_note.buffer_state())["stream"] == []


async def test_versioned_write_is_stale_while_only_a_buffered_tail_is_pending(
    live_note: BufferedDocument,
) -> None:
    async def versioned_write(content: str, version: int) -> Note:
        async with open_session() as db:
            operations = NoteOperations(
                db, MagicMock(spec=ObjectStorage), AsyncMock(spec=SearchIndexer)
            )
            return await NoteUpdates(operations, live_note.buffer).update(
                live_note.owner,
                live_note.org,
                live_note.key[1],
                content=content,
                expected_content_version=version,
            )

    await live_note.admit("u-alice", typed(live_note.base, suffix=" Alice"), live_note.peer)
    projected = await stored(live_note.key)
    assert projected.revision == projected.rendered_revision
    read = await note_row(live_note)
    before = await unchanged(live_note)

    with pytest.raises(StaleContentVersionError):
        await versioned_write("agent rewrite", read.version)

    assert await unchanged(live_note) == before
    result = await checkpoint_document(
        live_note.buffer, live_note.head.scope, enqueue=live_note.jobs
    )
    assert result.status is CheckpointStatus.COMMITTED
    assert await persist_snapshot(*live_note.key, live_note.org, b"", b"") == (
        SnapshotOutcome.RENDERED
    )
    reread = await note_row(live_note)
    assert reread.content == "base Alice"
    written = await versioned_write("base Alice agent", reread.version)
    assert (written.content, written.version) == ("base Alice agent", reread.version + 1)


async def test_metadata_rpc_leaves_checkpoint_and_buffer_alone_even_without_valkey(
    live_note: BufferedDocument, unreachable_buffer, doc_messages
) -> None:
    await live_note.admit("u-alice", typed(live_note.base, suffix=" Alice"))
    (_, content, version), checkpoint, buffered = await unchanged(live_note)

    response = await update_note(live_note, unreachable_buffer, title="Renamed")

    assert response.note.title == "Renamed"
    assert await unchanged(live_note) == (("Renamed", content, version), checkpoint, buffered)
    assert await published_progress(doc_messages) == []


async def test_unverifiable_buffer_fails_the_text_rpc_retryably_and_the_retry_lands(
    live_note: BufferedDocument, unreachable_buffer
) -> None:
    await live_note.admit("u-alice", typed(live_note.base, suffix=" Alice"), live_note.peer)
    before = await unchanged(live_note)
    submission = {"title": "Agenda", "content": "base agent", "base_content": "base"}

    with pytest.raises(ConnectError) as refused:
        await update_note(live_note, unreachable_buffer, **submission)

    assert refused.value.code is Code.UNAVAILABLE
    assert await unchanged(live_note) == before
    response = await update_note(live_note, live_note.buffer, **submission)
    assert (response.note.title, response.note.content) == ("Agenda", "base Alice agent")
    assert (await stored(live_note.key)).checkpoint_seq == 1


async def test_failed_note_write_after_the_merge_keeps_the_checkpoint_and_tail(
    live_note: BufferedDocument,
) -> None:
    await live_note.admit("u-alice", typed(live_note.base, suffix=" Alice"), live_note.peer)
    before = await unchanged(live_note)

    # The title column rejects this length, after the merge has already been staged.
    with pytest.raises(ConnectError):
        await update_note(
            live_note, live_note.buffer, title="x" * 501, content="base agent", base_content="base"
        )

    assert await unchanged(live_note) == before
    async with open_session() as db:
        await lock_document(db, live_note.key, live_note.org)
        live = await load_live_document(live_note.buffer, db, live_note.key)
    assert live is not None and live.text() == "base Alice"
