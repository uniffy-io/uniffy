"""Refresh note search and mention projections."""

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.notes.note import Note
from uniffy.core.valkey.mentions import publish_mention_state
from uniffy.domains.notes.operations import NoteOperations


async def refresh_note_search_projection(session: AsyncSession, note: Note) -> None:
    operations = NoteOperations(session)
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
