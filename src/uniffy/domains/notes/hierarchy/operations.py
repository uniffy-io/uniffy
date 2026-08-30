"""Note tree, restore, and trash operations."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import select

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.notes.note import Note
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType, NodeType
from uniffy.domains.files.attachments.purge import purge_attachments_for_content
from uniffy.domains.notes import queries
from uniffy.domains.tags.context import ContentTagContext

if TYPE_CHECKING:
    from uniffy.domains.notes.operations import NoteOperations

_MAX_TREE_DEPTH = 64


class NoteHierarchy:
    def __init__(self, operations: NoteOperations) -> None:
        self.operations = operations

    async def require_moveable_under(
        self,
        note_id: UUID,
        parent_id: UUID,
        organization_id: UUID,
    ) -> None:
        if parent_id == note_id:
            raise ValidationError("parent_id", "A note cannot be its own parent")

        current: UUID | None = parent_id
        for _ in range(_MAX_TREE_DEPTH):
            if current is None:
                return
            if current == note_id:
                raise ValidationError("parent_id", "Cannot move a folder into its own subtree")
            current = (
                await self.operations.session.execute(
                    select(Note.parent_id).where(
                        Note.id == current,
                        Note.organization_id == organization_id,
                    )
                )
            ).scalar_one_or_none()
        raise ValidationError("parent_id", "Folder nesting is too deep")

    async def delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        note_id: UUID,
        permanent: bool = False,
    ) -> bool:
        note = await self.operations._fetch_by_id(note_id, organization_id)
        if not note:
            raise NotFoundError("Note", note_id)
        await self.operations._require_delete(user_id, organization_id, note)

        parent_folder_id = note.parent_id
        removed_ids = await self.operations._collect_descendant_ids(note)
        if permanent:
            await purge_attachments_for_content(
                self.operations.session,
                self.operations.storage,
                self.operations.search_indexer,
                organization_id=organization_id,
                content_type=ContentType.NOTE,
                content_ids=removed_ids,
            )
            await queries.permanent_delete_recursive(self.operations.session, note)
        else:
            await queries.soft_delete_recursive(self.operations.session, note)

        if permanent:
            tags = ContentTagContext(self.operations.session)
            for removed_id in removed_ids:
                await tags.unassign_all_for_urn(
                    actor_id=user_id,
                    organization_id=organization_id,
                    content_urn=build_content_urn(ContentType.NOTE, removed_id),
                )

        for removed_id in removed_ids:
            await self.operations.search_indexer.remove(
                build_content_urn(ContentType.NOTE, removed_id)
            )

        await write_audit_event(
            self.operations.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=(Action.NOTE_PERMANENTLY_DELETED if permanent else Action.NOTE_DELETED),
            resource_type=AuditResourceType.NOTE,
            resource_id=note_id,
            details={
                "title": note.title,
                "node_type": note.node_type.value,
                "descendant_count": max(0, len(removed_ids) - 1),
            },
        )
        await self.operations.session.commit()
        await self.operations._refresh_parent_folder(parent_folder_id, organization_id)
        return True

    async def restore(
        self,
        user_id: UUID,
        organization_id: UUID,
        note_id: UUID,
    ) -> Note:
        note = await self.operations._fetch_by_id(note_id, organization_id)
        if not note:
            raise NotFoundError("Note", note_id)
        await self.operations._require_edit(user_id, organization_id, note)

        note.is_deleted = False
        note.deleted_at = None
        note.updated_at = datetime.now(UTC)
        await write_audit_event(
            self.operations.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=Action.NOTE_RESTORED,
            resource_type=AuditResourceType.NOTE,
            resource_id=note_id,
            details={"title": note.title, "node_type": note.node_type.value},
        )
        await self.operations.session.commit()
        await self.operations.session.refresh(note)
        await self.operations._index_for_search(note)
        await self.operations.session.commit()
        await self.operations._refresh_parent_folder(note.parent_id, organization_id)
        return note

    async def empty_trash(self, user_id: UUID, organization_id: UUID) -> int:
        access_filter = await self.operations.access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=ContentType.NOTE,
            content_id_column=Note.id,
            owner_id_column=Note.owner_id,
            access_mode_column=Note.access_mode,
            baseline_role_column=Note.baseline_role,
        )
        trash_ids = list(
            (
                await self.operations.session.execute(
                    select(Note.id).where(
                        Note.organization_id == organization_id,
                        Note.owner_id == user_id,
                        Note.is_deleted == True,  # noqa: E712
                        access_filter,
                    )
                )
            )
            .scalars()
            .all()
        )
        await purge_attachments_for_content(
            self.operations.session,
            self.operations.storage,
            self.operations.search_indexer,
            organization_id=organization_id,
            content_type=ContentType.NOTE,
            content_ids=trash_ids,
        )
        count = await queries.empty_trash(
            self.operations.session,
            organization_id,
            trash_ids,
        )

        tags = ContentTagContext(self.operations.session)
        for note_id in trash_ids:
            urn = build_content_urn(ContentType.NOTE, note_id)
            await tags.unassign_all_for_urn(
                actor_id=user_id,
                organization_id=organization_id,
                content_urn=urn,
            )
            await self.operations.search_indexer.remove(urn)
            await write_audit_event(
                self.operations.session,
                organization_id=organization_id,
                actor_user_id=user_id,
                action=Action.NOTE_PERMANENTLY_DELETED,
                resource_type=AuditResourceType.NOTE,
                resource_id=note_id,
                details={"source": "empty_trash"},
            )
        await self.operations.session.commit()
        return count

    async def collect_descendant_ids(self, note: Note) -> list[UUID]:
        ids = [note.id]
        if note.node_type != NodeType.FOLDER:
            return ids
        children = (
            (
                await self.operations.session.execute(
                    select(Note).where(
                        Note.parent_id == note.id,
                        Note.is_deleted == False,  # noqa: E712
                    )
                )
            )
            .scalars()
            .all()
        )
        for child in children:
            ids.extend(await self.collect_descendant_ids(child))
        return ids
