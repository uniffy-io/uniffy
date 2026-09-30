"""Search, mention, and realtime persistence for notes."""

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.notes.note import Note
from uniffy.core.search.indexer import SearchIndexer
from uniffy.domains.notes.content.fields import extract_canvas_text
from uniffy.domains.notes.content.notifications import NoteNotifications
from uniffy.domains.notes.content.projections import NoteProjections
from uniffy.domains.notes.content.realtime import NoteRealtimePersistence
from uniffy.domains.notes.content.updates import NoteUpdates
from uniffy.domains.notes.reader import NoteReader


class NoteProjectionOperations(NoteReader):
    def __init__(self, session: AsyncSession, search_indexer: SearchIndexer) -> None:
        super().__init__(session, search_indexer)

    def _build_search_keywords(self, model: Note) -> str:
        return NoteProjections(self).build_search_keywords(model)

    def _get_search_title(self, model: Note) -> str:
        return model.title

    def _get_url_path(self, model: Note) -> str:
        return f"/notes/{model.id}"

    def _get_search_description(self, model: Note) -> str | None:
        return NoteProjections(self).get_search_description(model)

    async def _get_search_tags_async(self, model: Note) -> list[str] | None:
        return await NoteProjections(self).get_search_tags(model)

    def _get_search_metadata(self, model: Note) -> dict[str, str] | None:
        return {"node_type": model.node_type.value}

    async def _get_search_metadata_async(self, model: Note) -> dict[str, str] | None:
        return await NoteProjections(self).get_search_metadata(model)

    async def _refresh_parent_folder(
        self,
        parent_id: UUID | None,
        organization_id: UUID,
    ) -> None:
        await NoteProjections(self).refresh_parent_folder(parent_id, organization_id)

    @staticmethod
    def _extract_canvas_text(canvas_data: dict) -> list[str]:
        return extract_canvas_text(canvas_data)

    async def realtime_save(
        self,
        organization_id: UUID,
        note_id: UUID,
        content: str,
        canvas_content: dict[str, Any] | None,
        *,
        actor_id: UUID | None = None,
    ) -> Note | None:
        return await NoteRealtimePersistence(self).save(
            organization_id,
            note_id,
            content,
            canvas_content,
            actor_id=actor_id,
        )

    async def _sync_tags_after_save(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        note: Note,
        tag_ids: list[UUID] | None,
        parsed_inline_names: list[str] | None,
    ) -> None:
        await NoteUpdates(self).sync_tags_after_save(
            user_id=user_id,
            organization_id=organization_id,
            note=note,
            tag_ids=tag_ids,
            parsed_inline_names=parsed_inline_names,
        )

    async def _notify_new_mentions(
        self,
        user_id: UUID,
        organization_id: UUID,
        note: Note,
        old_refs: list[str] | None,
        writer_id: UUID | None = None,
    ) -> None:
        await NoteNotifications(self).notify_new_mentions(
            user_id,
            organization_id,
            note,
            old_refs,
            writer_id,
        )

    async def _refresh_children_parent_label(self, parent: Note) -> None:
        await NoteProjections(self).refresh_children_parent_label(parent)

    async def _propagate_title_to_mentions(
        self,
        organization_id: UUID,
        note: Note,
    ) -> None:
        await NoteProjections(self).propagate_title(organization_id, note)
