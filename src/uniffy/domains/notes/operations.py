"""Stable note operations façade."""

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.notes.note import Note
from uniffy.core.search.indexer import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    NodeType,
)
from uniffy.domains.notes.content.creation import NoteCreation
from uniffy.domains.notes.content.fields import (
    NoteContentFields,
    extract_content_fields,
)
from uniffy.domains.notes.content.notifications import NoteNotifications
from uniffy.domains.notes.content.updates import NoteUpdates
from uniffy.domains.notes.hierarchy.operations import NoteHierarchy
from uniffy.domains.notes.projection import NoteProjectionOperations
from uniffy.domains.notes.sharing.operations import NoteSharing

_NoteContentFields = NoteContentFields


class NoteOperations(NoteProjectionOperations):
    """Public note API composed from cohesive domain collaborators."""

    def __init__(
        self,
        session: AsyncSession,
        storage: ObjectStorage,
        search_indexer: SearchIndexer,
    ) -> None:
        super().__init__(session, search_indexer)
        self.storage = storage

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
        expected_content_version: int | None = None,
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
            expected_content_version=expected_content_version,
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

    async def empty_trash(self, user_id: UUID, organization_id: UUID) -> int:
        return await NoteHierarchy(self).empty_trash(user_id, organization_id)

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

    async def _emit_shared_notification(
        self,
        user_id: UUID,
        organization_id: UUID,
        note: Note,
    ) -> None:
        await NoteNotifications(self).emit_shared(user_id, organization_id, note)

    async def _require_moveable_under(
        self,
        note_id: UUID,
        parent_id: UUID,
        organization_id: UUID,
    ) -> None:
        await NoteHierarchy(self).require_moveable_under(note_id, parent_id, organization_id)

    async def _collect_descendant_ids(self, note: Note) -> list[UUID]:
        return await NoteHierarchy(self).collect_descendant_ids(note)


__all__ = ["NoteOperations"]
