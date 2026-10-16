"""Note column writes keep their version compare-and-swap and audit facts on real PostgreSQL."""

import contextlib
from collections.abc import AsyncIterator, Iterator
from datetime import timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
import pytest_asyncio
from prometheus_client import REGISTRY
from sqlalchemy import Update, delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit.actions import Action
from uniffy.core.errors import ConflictError
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.files.reconciliation import InlineAttachmentReconciliation
from uniffy.core.models.notes.note import Note
from uniffy.core.realtime.adapter import RealtimeRenderConflict, RealtimeRenderSuperseded
from uniffy.core.search.indexer import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.core.types import AccessMode, NodeType, generate_id
from uniffy.domains.notes.operations import NoteOperations
from uniffy.domains.notes.projection import NoteProjectionOperations
from uniffy.infrastructure.database.session import open_session
from uniffy.tests.integration.access.realtime_live import unreachable

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _note(access, title: str, **fields) -> Note:
    return Note(
        organization_id=access.org_id,
        owner_id=access.member_id,
        title=title,
        slug=f"{title.lower()}-{generate_id().hex}",
        access_mode=AccessMode.OWNER_ONLY,
        **fields,
    )


@pytest_asyncio.fixture(loop_scope="session")
async def note(access) -> AsyncIterator[Note]:
    """A member's private note at version 1."""
    async with open_session() as db:
        row = _note(access, "Contended", content="existing text")
        db.add(row)
        await db.commit()
    try:
        yield row
    finally:
        async with open_session() as db:
            await db.execute(
                delete(InlineAttachmentReconciliation).where(
                    InlineAttachmentReconciliation.content_id == row.id
                )
            )
            await db.execute(delete(Note).where(Note.id == row.id))
            await db.commit()


@contextlib.contextmanager
def contended(session: AsyncSession, note_id: UUID, races: int) -> Iterator[None]:
    """A peer commits a metadata write just before each of the session's first ``races`` updates."""
    execute = session.execute
    remaining = races

    async def racing(statement, *args, **kwargs):
        nonlocal remaining
        if isinstance(statement, Update) and remaining:
            remaining -= 1
            async with open_session() as peer:
                await peer.execute(
                    update(Note)
                    .where(Note.id == note_id)
                    .values(title="Peer title", version=Note.version + 1)
                )
                await peer.commit()
        return await execute(statement, *args, **kwargs)

    with patch.object(session, "execute", side_effect=racing):
        yield


async def stored(note: Note) -> Note:
    async with open_session() as db:
        row = await db.get(Note, note.id)
    assert row is not None
    return row


async def render(note: Note, content: str, *, races: int = 0, **options) -> Note | None:
    async with open_session() as db:
        operations = NoteProjectionOperations(db, AsyncMock(spec=SearchIndexer))
        with contended(db, note.id, races):
            return await operations.realtime_save(
                note.organization_id, note.id, content, None, **options
            )


def blank_overwrites() -> float:
    sample = REGISTRY.get_sample_value(
        "uniffy_realtime_blank_content_overwrites_total", {"content_type": "NOTE"}
    )
    return sample or 0.0


@pytest.mark.parametrize(("content", "counted"), [("", 1), ("fresh text", 0)])
async def test_render_writes_its_text_and_counts_only_a_blanked_note(
    note: Note, content: str, counted: int
) -> None:
    before = blank_overwrites()

    await render(note, content)

    row = await stored(note)
    assert (row.content, row.version) == (content, 2)
    assert blank_overwrites() == before + counted


@pytest.mark.parametrize("races", [1, 3])
async def test_render_retries_a_lost_version_race_and_gives_up_after_three(
    note: Note, races: int
) -> None:
    if races == 3:
        with pytest.raises(RealtimeRenderConflict):
            await render(note, "rendered", races=races)
    else:
        await render(note, "rendered", races=races)

    row = await stored(note)
    assert row.title == "Peer title"
    assert row.content == ("existing text" if races == 3 else "rendered")
    assert row.version == 1 + races + (races == 1)


async def test_render_encoded_before_a_differing_plain_write_never_overwrites_it(
    note: Note,
) -> None:
    written = (await stored(note)).updated_at

    with pytest.raises(RealtimeRenderSuperseded):
        await render(note, "stale live text", supersede_after=written - timedelta(seconds=5))

    row = await stored(note)
    assert (row.content, row.version) == ("existing text", 1)


async def test_render_equal_to_a_later_plain_write_still_lands(note: Note) -> None:
    written = (await stored(note)).updated_at

    saved = await render(note, "existing text", supersede_after=written - timedelta(seconds=5))

    assert saved is not None
    row = await stored(note)
    assert (row.content, row.version) == ("existing text", 1)


async def test_metadata_write_gives_up_after_three_lost_version_races(note: Note) -> None:
    # Metadata writes never read live state, so an unreachable buffer cannot stop them.
    async with open_session() as db, unreachable(f"test:{generate_id().hex}:") as buffer:
        operations = NoteOperations(
            db, MagicMock(spec=ObjectStorage), AsyncMock(spec=SearchIndexer), buffer
        )
        with contended(db, note.id, 3), pytest.raises(ConflictError):
            await operations.update(note.owner_id, note.organization_id, note.id, title="Renamed")

    row = await stored(note)
    assert (row.title, row.version) == ("Peer title", 4)


async def test_moving_a_note_records_its_previous_and_new_parent(note: Note, access) -> None:
    async with open_session() as db:
        folder = _note(access, "Folder", node_type=NodeType.FOLDER)
        db.add(folder)
        await db.commit()
    try:
        async with open_session() as db, unreachable(f"test:{generate_id().hex}:") as buffer:
            operations = NoteOperations(
                db, MagicMock(spec=ObjectStorage), AsyncMock(spec=SearchIndexer), buffer
            )
            await operations.update(
                note.owner_id, note.organization_id, note.id, parent_id=folder.id
            )
        async with open_session() as db:
            rows = (
                await db.execute(
                    select(AuditEvent.action, AuditEvent.actor_user_id, AuditEvent.details).where(
                        AuditEvent.organization_id == note.organization_id,
                        AuditEvent.resource_id == note.id,
                    )
                )
            ).all()
        assert [
            (action, actor, details["previous_parent_id"], details["new_parent_id"])
            for action, actor, details in rows
        ] == [(Action.NOTE_MOVED, note.owner_id, None, str(folder.id))]
        assert (await stored(note)).parent_id == folder.id
    finally:
        async with open_session() as db:
            await db.execute(update(Note).where(Note.id == note.id).values(parent_id=None))
            await db.execute(delete(Note).where(Note.id == folder.id))
            await db.commit()
