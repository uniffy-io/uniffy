"""Read operations for notes."""

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.models.notes.note import Note
from uniffy.core.search.indexer import SearchIndexer
from uniffy.core.types import AccessMode, ContentType, NodeType, ParentSelection, SortOrder
from uniffy.domains.notes.browse.operations import NoteBrowser
from uniffy.domains.notes.content.fields import extract_canvas_text
from uniffy.domains.notes.registration import register_note_content
from uniffy.domains.notes.sharing.queries import NoteSharingInfo, NoteSharingQueries


class NoteReader(BaseContentOperations[Note]):
    content_type = ContentType.NOTE
    model_class = Note

    def __init__(
        self,
        session: AsyncSession,
        search_indexer: SearchIndexer | None = None,
    ) -> None:
        register_note_content()
        super().__init__(session, search_indexer)

    def _build_search_keywords(self, model: Note) -> str:
        parts = [model.title]
        if model.node_type == NodeType.CANVAS and model.canvas_content:
            parts.extend(extract_canvas_text(model.canvas_content))
        elif model.content:
            parts.append(model.content)
        return " ".join(parts)

    def _get_search_title(self, model: Note) -> str:
        return model.title

    def _get_url_path(self, model: Note) -> str:
        return f"/notes/{model.id}"

    async def get_backlinks(
        self,
        user_id: UUID,
        organization_id: UUID,
        note_id: UUID,
    ) -> list[Note]:
        return await NoteBrowser(self).get_backlinks(user_id, organization_id, note_id)

    async def list_notes(
        self,
        user_id: UUID,
        organization_id: UUID,
        parent_id: UUID | ParentSelection | None = None,
        access_mode: AccessMode | None = None,
        group_id: UUID | None = None,
        personal_only: bool = False,
        include_deleted: bool = False,
        tag_ids: list[UUID] | None = None,
        node_types: list[NodeType] | None = None,
        page: int = 1,
        page_size: int = 50,
        sort_by: str = "updated_at",
        sort_order: SortOrder = SortOrder.DESCENDING,
    ) -> tuple[list[Note], int]:
        return await NoteBrowser(self).list_notes(
            user_id=user_id,
            organization_id=organization_id,
            parent_id=parent_id,
            access_mode=access_mode,
            group_id=group_id,
            personal_only=personal_only,
            include_deleted=include_deleted,
            tag_ids=tag_ids,
            node_types=node_types,
            page=page,
            page_size=page_size,
            sort_by=sort_by,
            sort_order=sort_order,
        )

    async def get_notes_sharing_info(
        self,
        notes: list[Note],
        current_user_id: UUID,
    ) -> dict[UUID, NoteSharingInfo]:
        return await NoteSharingQueries(self).get_notes_sharing_info(notes, current_user_id)

    async def _apply_access_filter(
        self,
        query: Any,
        user_id: UUID,
        organization_id: UUID,
        *,
        personal_only: bool,
    ) -> Any:
        return await NoteBrowser(self).apply_access_filter(
            query,
            user_id,
            organization_id,
            personal_only=personal_only,
        )

    @staticmethod
    def _tag_filter_subquery(tag_ids: list[UUID]):
        return NoteBrowser.tag_filter_subquery(tag_ids)

    @staticmethod
    def _group_member_subquery(organization_id: UUID, group_id: UUID):
        return NoteBrowser.group_member_subquery(organization_id, group_id)
