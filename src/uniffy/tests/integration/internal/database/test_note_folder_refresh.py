"""_refresh_parent_folder computes its search metadata exactly once."""

from unittest.mock import AsyncMock

import pytest
from sqlalchemy import delete

from uniffy.core.models.notes.note import Note
from uniffy.core.search.indexer import SearchIndexer
from uniffy.core.types import NodeType, generate_id
from uniffy.domains.notes.operations import NoteOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_refresh_parent_folder_computes_metadata_once(session, env, monkeypatch) -> None:
    monkeypatch.setattr(SearchIndexer, "index", AsyncMock())
    published: list[dict] = []

    async def capture(organization_id, urn, changes):
        published.append(dict(changes))

    monkeypatch.setattr("uniffy.domains.notes.operations.publish_mention_state", capture)

    calls = 0
    original = NoteOperations._get_search_metadata_async

    async def counting(self, model):
        nonlocal calls
        calls += 1
        return await original(self, model)

    monkeypatch.setattr(NoteOperations, "_get_search_metadata_async", counting)

    folder_note = Note(
        organization_id=env.org_id,
        owner_id=env.admin_id,
        title="itdb-note-folder",
        slug=f"itdb-{generate_id().hex[:8]}",
        node_type=NodeType.FOLDER,
    )
    session.add(folder_note)
    await session.commit()

    try:
        await NoteOperations(session)._refresh_parent_folder(folder_note.id, env.org_id)
        assert calls == 1
        assert published and published[0]["child_count"] == "0"
    finally:
        await session.rollback()
        await session.execute(delete(Note).where(Note.organization_id == env.org_id))
        await session.commit()
