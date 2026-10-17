"""Canvas notes take the buffered realtime path through the shared note adapter."""

import dataclasses
from collections.abc import AsyncIterator
from typing import Any

import pycrdt
import pytest
import pytest_asyncio
from sqlalchemy import delete

from uniffy.core.models.notes.note import Note
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.buffer_keys import AdmissionStatus
from uniffy.core.realtime.checkpoint import CheckpointStatus, checkpoint_document
from uniffy.core.realtime.job_contracts import PROJECT_REALTIME_DOCUMENT
from uniffy.core.realtime.lifecycle import stage_replacement
from uniffy.core.realtime.live import load_live_document
from uniffy.core.realtime.snapshot import SnapshotOutcome, persist_snapshot
from uniffy.core.realtime.storage import (
    GenerationConflict,
    load_snapshot,
    lock_document,
    stage_seed,
)
from uniffy.core.types import ContentType, NodeType, generate_id
from uniffy.infrastructure.database.session import open_session
from uniffy.tests.integration.access.realtime_live import (
    BufferedDocument,
    document,
    establish,
    live_note,  # noqa: F401 - fixture
    stored,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")


def canvas(*texts: tuple[str, str]) -> dict[str, Any]:
    return {
        "version": 1,
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": [
            {
                "id": node,
                "type": "text",
                "position": {"x": 0, "y": 0},
                "data": {"type": "text", "content": text},
            }
            for node, text in texts
        ],
        "edges": [],
    }


def retyped(*history: bytes, node: str, suffix: str) -> bytes:
    """An editor typing at the end of one text node it has seen."""
    doc = document(*history)
    before = doc.get_state()
    content = doc.get("nodes", type=pycrdt.Map)[node]["data"]["content"]
    content.insert(len(str(content)), suffix)
    return doc.get_update(before)


def added(*history: bytes, node: str, text: str) -> bytes:
    """An editor dropping a new text node onto the canvas it has seen."""
    doc = document(*history)
    before = doc.get_state()
    doc.get("nodes", type=pycrdt.Map)[node] = pycrdt.Map({
        "id": node,
        "type": "text",
        "position": {"x": 40, "y": 0},
        "data": pycrdt.Map({"type": "text", "content": pycrdt.Text(text)}),
    })
    doc.get("order", type=pycrdt.Array).append(node)
    return doc.get_update(before)


def node_texts(doc: pycrdt.Doc) -> dict[str, str]:
    nodes = doc.get("nodes", type=pycrdt.Map).to_py()
    return {node: value["data"]["content"] for node, value in nodes.items()}


@pytest_asyncio.fixture(loop_scope="session")
async def live_canvas(live_note) -> AsyncIterator[BufferedDocument]:
    """A canvas note seeded from its column and bound to the live note's buffer."""
    async with open_session() as db:
        note = Note(
            organization_id=live_note.org,
            owner_id=live_note.owner,
            title="Board",
            slug=f"board-{generate_id().hex}",
            node_type=NodeType.CANVAS,
            canvas_content=canvas(("t1", "Plan")),
        )
        db.add(note)
        await db.commit()
        key = (ContentType.NOTE, note.id)
        await lock_document(db, key, live_note.org)
        await stage_seed(db, key, live_note.org)
        row = await load_snapshot(db, key)
        assert row is not None
        await db.commit()
    assert row.generation is not None
    try:
        yield dataclasses.replace(
            live_note,
            key=key,
            base=row.updates,
            generation=row.generation,
            head=await establish(live_note.buffer, key, live_note.org),
        )
    finally:
        async with open_session() as db:
            await db.execute(
                delete(RealtimeYjsSnapshot).where(RealtimeYjsSnapshot.content_id == key[1])
            )
            await db.execute(delete(Note).where(Note.id == key[1]))
            await db.commit()


async def _two_editors(board: BufferedDocument) -> bytes:
    alice = retyped(board.base, node="t1", suffix=" Alice")
    await board.admit("u-alice", alice, board.owner)
    await board.admit("u-bob", added(board.base, node="n2", text="Bob"), board.peer)
    return alice


async def test_two_canvas_editors_converge_in_live_state_before_any_checkpoint(
    live_canvas: BufferedDocument,
) -> None:
    await _two_editors(live_canvas)

    async with open_session() as db:
        await lock_document(db, live_canvas.key, live_canvas.org)
        live = await load_live_document(live_canvas.buffer, db, live_canvas.key)

    assert live is not None
    assert [(record.seq, record.actor_id) for record in live.tail] == [
        (1, live_canvas.owner),
        (2, live_canvas.peer),
    ]
    doc = live.decode()
    assert node_texts(doc) == {"t1": "Plan Alice", "n2": "Bob"}
    assert doc.get("order", type=pycrdt.Array).to_py() == ["t1", "n2"]
    row = await stored(live_canvas.key)
    assert (row.updates, row.checkpoint_seq) == (live_canvas.base, 0)


async def test_canvas_checkpoint_commits_both_edits_and_projection_renders_them(
    live_canvas: BufferedDocument,
) -> None:
    await _two_editors(live_canvas)

    result = await checkpoint_document(
        live_canvas.buffer, live_canvas.head.scope, enqueue=live_canvas.jobs
    )

    assert (result.status, result.covered) == (CheckpointStatus.COMMITTED, 2)
    row = await stored(live_canvas.key)
    assert row.checkpoint_seq == 2
    assert node_texts(document(row.updates)) == {"t1": "Plan Alice", "n2": "Bob"}
    assert (await live_canvas.buffer_state())["stream"] == []
    assert live_canvas.jobs.jobs == [
        (
            PROJECT_REALTIME_DOCUMENT.name,
            f"{live_canvas.namespace}projection:{ContentType.NOTE.value}:"
            f"{live_canvas.key[1]}:{row.revision}",
            (ContentType.NOTE.value, str(live_canvas.key[1]), str(live_canvas.org)),
        )
    ]
    outcome = await persist_snapshot(*live_canvas.key, live_canvas.org)
    assert outcome is SnapshotOutcome.RENDERED
    async with open_session() as db:
        note = await db.get(Note, live_canvas.key[1])
    assert note is not None and note.canvas_content is not None
    assert [(node["id"], node["data"]["content"]) for node in note.canvas_content["nodes"]] == [
        ("t1", "Plan Alice"),
        ("n2", "Bob"),
    ]


async def test_canvas_replacement_rotates_generation_while_a_buffered_edit_waits(
    live_canvas: BufferedDocument,
) -> None:
    alice = await _two_editors(live_canvas)

    async with open_session() as db:
        await lock_document(db, live_canvas.key, live_canvas.org)
        note = await db.get(Note, live_canvas.key[1])
        assert note is not None
        note.canvas_content = canvas(("r1", "Replaced"))
        after_commit = await stage_replacement(
            live_canvas.buffer, db, live_canvas.key, live_canvas.org
        )
        await db.commit()
    await after_commit()

    row = await stored(live_canvas.key)
    assert row.generation not in (None, live_canvas.generation)
    assert node_texts(document(row.updates)) == {"r1": "Replaced"}
    assert (row.buffer_epoch, row.checkpoint_seq) == (None, 0)
    assert await live_canvas.buffer_state() == {
        "stream": [],
        "control": 0,
        "receipts": [],
        "due": None,
    }
    late = await live_canvas.buffer.admit(
        live_canvas.head,
        update_id="u-late",
        update=retyped(live_canvas.base, alice, node="t1", suffix=" late"),
        actor_id=live_canvas.owner,
    )
    assert late.status is AdmissionStatus.RECOVERY_REQUIRED
    with pytest.raises(GenerationConflict):
        await live_canvas.admit_live("u-stale", alice)
