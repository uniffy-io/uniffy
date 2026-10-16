"""Ordinary note text writes merge into live state and commit the buffered tail they cover."""

from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.notes.v1.notes_pb import UpdateNoteRequest, UpdateNoteResponse

from uniffy.core.errors import StaleContentVersionError
from uniffy.core.json_codec import loads
from uniffy.core.models.notes.note import Note
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.realtime.checkpoint import CheckpointStatus, checkpoint_document
from uniffy.core.realtime.live import load_live_document
from uniffy.core.realtime.snapshot import SnapshotOutcome, persist_snapshot
from uniffy.core.realtime.storage import lock_document
from uniffy.core.search.indexer import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.core.types import ContentType
from uniffy.domains.agents.tools.builtin import notes as note_tools
from uniffy.domains.agents.tools.definitions import ToolContext
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
from uniffy.tests.integration.access.recording_search import recording_indexer
from uniffy.tests.integration.access.rpc_calls import call_rpc

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def update_note(
    note: BufferedDocument, buffer: UpdateBuffer, **fields: Any
) -> UpdateNoteResponse:
    """Call the UpdateNote RPC as the note's owner, against ``buffer``."""
    service = NotesServiceImpl(MagicMock(spec=ObjectStorage), AsyncMock(spec=SearchIndexer))
    service.buffer = buffer
    request = UpdateNoteRequest(note_id=str(note.key[1]), organization_id=str(note.org), **fields)
    return await call_rpc(service.update_note, request, user_id=note.owner, organization_id=note.org)


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


async def test_versioned_write_is_stale_until_buffered_edits_are_projected(
    live_note: BufferedDocument,
) -> None:
    async def versioned_write(content: str, version: int) -> Note:
        async with open_session() as db:
            operations = NoteOperations(
                db, MagicMock(spec=ObjectStorage), AsyncMock(spec=SearchIndexer), live_note.buffer
            )
            return await operations.update(
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
    checkpointed = await stored(live_note.key)
    assert checkpointed.revision > checkpointed.rendered_revision
    with pytest.raises(StaleContentVersionError):
        await versioned_write("agent rewrite", read.version)
    assert text_of((await stored(live_note.key)).updates) == "base Alice"
    assert await persist_snapshot(*live_note.key, live_note.org) == (SnapshotOutcome.RENDERED)
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


def agent(db: AsyncSession, note: BufferedDocument) -> ToolContext:
    """The note owner's agent run, reading and writing through the note's buffer."""
    return ToolContext(
        session=db,
        user_id=note.owner,
        organization_id=note.org,
        buffer=note.buffer,
        storage=MagicMock(spec=ObjectStorage),
        search_indexer=recording_indexer(),
    )


async def agent_read(context: ToolContext, note: BufferedDocument) -> int:
    result = await note_tools.read_note.executor(context, {"note_id": str(note.key[1])})
    assert result.success
    return loads(result.data)["version"]


async def test_agent_write_from_a_read_older_than_buffered_edits_changes_nothing(
    live_note: BufferedDocument,
) -> None:
    async with open_session() as db:
        context = agent(db, live_note)
        version = await agent_read(context, live_note)
        await live_note.admit("u-alice", typed(live_note.base, suffix=" Alice"), live_note.peer)
        before = await unchanged(live_note)

        refused = await note_tools.update_note.executor(
            context,
            {"note_id": str(live_note.key[1]), "content": "agent", "expected_version": version},
        )

    assert not refused.success
    assert refused.error is not None and "No content was changed" in refused.error
    assert (ContentType.NOTE, live_note.key[1]) not in context.observed_content_versions
    assert await unchanged(live_note) == before


async def test_agent_write_after_rereading_projected_edits_keeps_them(
    live_note: BufferedDocument,
) -> None:
    await live_note.admit("u-alice", typed(live_note.base, suffix=" Alice"), live_note.peer)
    result = await checkpoint_document(
        live_note.buffer, live_note.head.scope, enqueue=live_note.jobs
    )
    assert result.status is CheckpointStatus.COMMITTED
    assert await persist_snapshot(*live_note.key, live_note.org) == (SnapshotOutcome.RENDERED)

    async with open_session() as db:
        context = agent(db, live_note)
        version = await agent_read(context, live_note)
        written = await note_tools.update_note.executor(
            context,
            {
                "note_id": str(live_note.key[1]),
                "content": "base Alice agent",
                "expected_version": version,
            },
        )

    assert written.success
    assert f"content version: {version + 1}" in written.data
    assert context.observed_content_versions[(ContentType.NOTE, live_note.key[1])] == version + 1
    assert (await note_row(live_note)).content == "base Alice agent"
    assert text_of((await stored(live_note.key)).updates) == "base Alice agent"


async def test_agent_truncated_read_cannot_authorize_a_content_replacement(
    live_note: BufferedDocument,
) -> None:
    async with open_session() as db:
        await db.execute(
            update(Note).where(Note.id == live_note.key[1]).values(content="x" * 50_001)
        )
        await db.commit()
        context = agent(db, live_note)
        result = await note_tools.read_note.executor(context, {"note_id": str(live_note.key[1])})

    payload = loads(result.data)
    assert payload["_truncated"] is True
    assert "Do not replace" in payload["_truncation_notice"]
    assert (ContentType.NOTE, live_note.key[1]) not in context.observed_content_versions


async def rows(note_ids: list[UUID]) -> list[Note]:
    async with open_session() as db:
        return list((await db.scalars(select(Note).where(Note.id.in_(note_ids)))).all())


async def test_agent_created_note_reports_its_first_content_version(
    live_note: BufferedDocument,
) -> None:
    async with open_session() as db:
        context = agent(db, live_note)
        result = await note_tools.create_note.executor(
            context, {"title": "Agent draft", "content": "draft"}
        )
    created = [content_id for _, content_id in context.observed_content_versions]
    try:
        assert result.success
        assert "content version: 1" in result.data
        assert list(context.observed_content_versions.values()) == [1]
        assert [(row.content, row.version) for row in await rows(created)] == [("draft", 1)]
    finally:
        async with open_session() as db:
            await db.execute(delete(Note).where(Note.id.in_(created)))
            await db.commit()
