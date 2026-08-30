"""Stable note operations façade."""

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.models.notes.note import Note
from uniffy.core.search.indexer import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
    NodeType,
    ParentSelection,
    SortOrder,
)
from uniffy.domains.notes.browse.operations import NoteBrowser
from uniffy.domains.notes.content.creation import NoteCreation
from uniffy.domains.notes.content.fields import (
    NoteContentFields,
    extract_canvas_text,
    extract_content_fields,
)
from uniffy.domains.notes.content.notifications import NoteNotifications
from uniffy.domains.notes.content.projections import NoteProjections
from uniffy.domains.notes.content.realtime import NoteRealtimePersistence
from uniffy.domains.notes.content.updates import NoteUpdates
from uniffy.domains.notes.hierarchy.operations import NoteHierarchy
from uniffy.domains.notes.registration import register_note_content
from uniffy.domains.notes.sharing.operations import NoteSharing
from uniffy.domains.notes.sharing.queries import NoteSharingInfo, NoteSharingQueries

_NoteContentFields = NoteContentFields


class NoteOperations(BaseContentOperations[Note]):
    """Public note API composed from cohesive domain collaborators."""

    content_type = ContentType.NOTE
    model_class = Note

    def __init__(
        self,
        session: AsyncSession,
        storage: ObjectStorage | None = None,
        search_indexer: SearchIndexer | None = None,
    ) -> None:
        register_note_content()
        super().__init__(session, search_indexer)
        self._storage = storage

    @property
    def storage(self) -> ObjectStorage:
        if self._storage is None:
            raise RuntimeError("Object storage is required for note attachment mutations")
        return self._storage

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

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        title: str,
        content: str = "",
        canvas_content: dict[str, Any] | None = None,
        slug: str | None = None,
        access_mode: AccessMode | None = None,
        baseline_role: ContentRole | None = None,
        node_type: NodeType = NodeType.NOTE,
        parent_id: UUID | None = None,
        tag_ids: list[UUID] | None = None,
        metadata: dict[str, Any] | None = None,
        group_ids: list[UUID] | None = None,
    ) -> Note:
        return await NoteCreation(self).create(
            user_id=user_id,
            organization_id=organization_id,
            title=title,
            content=content,
            canvas_content=canvas_content,
            slug=slug,
            access_mode=access_mode,
            baseline_role=baseline_role,
            node_type=node_type,
            parent_id=parent_id,
            tag_ids=tag_ids,
            metadata=metadata,
            group_ids=group_ids,
        )

    async def update(
        self,
        user_id: UUID,
        organization_id: UUID,
        note_id: UUID,
        title: str | None = None,
        content: str | None = None,
        canvas_content: dict[str, Any] | None = None,
        slug: str | None = None,
        parent_id: UUID | None | str = None,
        tag_ids: list[UUID] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> Note:
        return await NoteUpdates(self).update(
            user_id=user_id,
            organization_id=organization_id,
            note_id=note_id,
            title=title,
            content=content,
            canvas_content=canvas_content,
            slug=slug,
            parent_id=parent_id,
            tag_ids=tag_ids,
            metadata=metadata,
        )

    async def delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        note_id: UUID,
        permanent: bool = False,
    ) -> bool:
        return await NoteHierarchy(self).delete(
            user_id,
            organization_id,
            note_id,
            permanent,
        )

    async def restore(
        self,
        user_id: UUID,
        organization_id: UUID,
        note_id: UUID,
    ) -> Note:
        return await NoteHierarchy(self).restore(user_id, organization_id, note_id)

    async def realtime_save(
        self,
        organization_id: UUID,
        note_id: UUID,
        content: str,
        canvas_content: dict[str, Any] | None,
    ) -> Note | None:
        return await NoteRealtimePersistence(self).save(
            organization_id,
            note_id,
            content,
            canvas_content,
        )

    async def move(
        self,
        user_id: UUID,
        organization_id: UUID,
        note_id: UUID,
        target_access_mode: AccessMode | None,
        target_baseline_role: ContentRole | None = None,
        target_group_ids: list[UUID] | None = None,
    ) -> Note:
        return await NoteSharing(self).move(
            user_id,
            organization_id,
            note_id,
            target_access_mode,
            target_baseline_role,
            target_group_ids,
        )

    async def get_backlinks(
        self,
        user_id: UUID,
        organization_id: UUID,
        note_id: UUID,
    ) -> list[Note]:
        return await NoteBrowser(self).get_backlinks(user_id, organization_id, note_id)

    async def empty_trash(self, user_id: UUID, organization_id: UUID) -> int:
        return await NoteHierarchy(self).empty_trash(user_id, organization_id)

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

    async def _unique_slug(self, base: str, organization_id: UUID) -> str:
        return await NoteCreation(self).unique_slug(base, organization_id)

    def _extract_content_fields(
        self,
        node_type: NodeType,
        content: str,
        canvas_content: dict[str, Any] | None,
        organization_id: UUID,
    ) -> NoteContentFields:
        return extract_content_fields(node_type, content, canvas_content, organization_id)

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

    async def _emit_shared_notification(
        self,
        user_id: UUID,
        organization_id: UUID,
        note: Note,
    ) -> None:
        await NoteNotifications(self).emit_shared(user_id, organization_id, note)

    async def _refresh_children_parent_label(self, parent: Note) -> None:
        await NoteProjections(self).refresh_children_parent_label(parent)

    async def _propagate_title_to_mentions(
        self,
        organization_id: UUID,
        note: Note,
    ) -> None:
        await NoteProjections(self).propagate_title(organization_id, note)

    async def _require_moveable_under(
        self,
        note_id: UUID,
        parent_id: UUID,
        organization_id: UUID,
    ) -> None:
        await NoteHierarchy(self).require_moveable_under(note_id, parent_id, organization_id)

    async def _collect_descendant_ids(self, note: Note) -> list[UUID]:
        return await NoteHierarchy(self).collect_descendant_ids(note)

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


__all__ = ["NoteOperations", "NoteSharingInfo"]
