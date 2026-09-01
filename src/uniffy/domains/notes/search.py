"""Refresh note search and mention projections."""

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.mentions import publish_mention_state
from uniffy.core.models.notes.note import Note
from uniffy.core.search.indexer import SearchIndexer
from uniffy.domains.notes.projection import NoteProjectionOperations


async def refresh_note_search_projection(
    session: AsyncSession,
    note: Note,
    search_indexer: SearchIndexer,
) -> None:
    operations = NoteProjectionOperations(session, search_indexer)
    metadata = await operations._index_for_search(note) or {}
    await publish_mention_state(
        organization_id=note.organization_id,
        urn=note.urn,
        changes={
            "title": note.title,
            "description": operations._get_search_description(note) or "",
            **metadata,
        },
    )
