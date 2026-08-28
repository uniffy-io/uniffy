"""Permission-filtered note lists and backlinks."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import String, cast, func, or_, select

from uniffy.core.errors import NotFoundError
from uniffy.core.models.notes.note import Note
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.tags.tag import TagAssignment
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
    NodeType,
    ParentSelection,
    SortOrder,
    SubjectType,
)
from uniffy.domains.notes import queries

if TYPE_CHECKING:
    from uniffy.domains.notes.operations import NoteOperations


class NoteBrowser:
    def __init__(self, operations: NoteOperations) -> None:
        self.operations = operations

    async def get_backlinks(
        self,
        user_id: UUID,
        organization_id: UUID,
        note_id: UUID,
    ) -> list[Note]:
        note = await self.operations._fetch_by_id(note_id, organization_id)
        if not note:
            raise NotFoundError("Note", note_id)
        await self.operations._require_view(user_id, organization_id, note)
        access_filter = await self._access_filter(user_id, organization_id)
        return await queries.get_backlinks(
            self.operations.session,
            note_id,
            organization_id,
            access_filter,
        )

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
        query = select(Note).where(Note.organization_id == organization_id)
        if node_types:
            query = query.where(Note.node_type.in_(node_types))
        query = await self.apply_access_filter(
            query,
            user_id,
            organization_id,
            personal_only=personal_only,
        )
        if group_id is not None:
            query = query.where(Note.id.in_(self.group_member_subquery(organization_id, group_id)))
        if parent_id == ParentSelection.ROOT:
            query = query.where(Note.parent_id.is_(None))
        elif parent_id:
            query = query.where(Note.parent_id == parent_id)
        if access_mode is not None:
            query = query.where(Note.access_mode == access_mode)
        if not include_deleted:
            query = query.where(Note.is_deleted == False)  # noqa: E712
        if tag_ids:
            query = query.where(Note.id.in_(self.tag_filter_subquery(tag_ids)))

        total = (
            await self.operations.session.execute(select(func.count()).select_from(query.subquery()))
        ).scalar() or 0
        sort_column = getattr(Note, sort_by, Note.updated_at)
        query = query.order_by(
            sort_column.asc() if sort_order == SortOrder.ASCENDING else sort_column.desc()
        )
        query = query.offset((page - 1) * page_size).limit(page_size)
        result = await self.operations.session.execute(query)
        return list(result.scalars().all()), total

    async def apply_access_filter(
        self,
        query: Any,
        user_id: UUID,
        organization_id: UUID,
        *,
        personal_only: bool,
    ) -> Any:
        query = query.where(await self._access_filter(user_id, organization_id))
        if personal_only:
            query = query.where(Note.owner_id == user_id)
        return query

    async def _access_filter(self, user_id: UUID, organization_id: UUID) -> Any:
        return await self.operations.access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=ContentType.NOTE,
            content_id_column=Note.id,
            owner_id_column=Note.owner_id,
            access_mode_column=Note.access_mode,
            baseline_role_column=Note.baseline_role,
        )

    @staticmethod
    def tag_filter_subquery(tag_ids: list[UUID]):
        urn_expression = func.concat("urn:uniffy:content:NOTE:", cast(Note.id, String))
        return (
            select(Note.id)
            .join(TagAssignment, TagAssignment.content_urn == urn_expression)
            .where(TagAssignment.tag_id.in_(tag_ids))
            .group_by(Note.id)
            .having(func.count(func.distinct(TagAssignment.tag_id)) == len(tag_ids))
        )

    @staticmethod
    def group_member_subquery(organization_id: UUID, group_id: UUID):
        now = datetime.now(UTC)
        return select(ContentMember.content_id).where(
            ContentMember.organization_id == organization_id,
            ContentMember.content_type == ContentType.NOTE,
            ContentMember.subject_type == SubjectType.GROUP,
            ContentMember.subject_id == group_id,
            ContentMember.role != ContentRole.BLOCKED,
            or_(ContentMember.expires_at.is_(None), ContentMember.expires_at > now),
        )
