"""Note tree, restore, and trash operations."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.auth.permissions.defaults import (
    resolve_content_defaults,
    resolve_effective_policy,
)
from uniffy.core.converters.common_proto import content_type_to_proto
from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.events.realtime import ContentAccessAction, publish_content_access_changed
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.notes.note import Note
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.realtime.checkpoint import Enqueue, enqueue_core
from uniffy.core.realtime.lifecycle import stage_hard_delete, stage_restore, stage_trash
from uniffy.core.realtime.live import AfterCommit
from uniffy.core.realtime.publisher import publish_perm_change
from uniffy.core.realtime.storage import lock_document, lock_documents
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import AccessMode, ContentType, NodeType
from uniffy.domains.files.attachments.purge import purge_attachments_for_content
from uniffy.domains.notes import queries
from uniffy.domains.permissions.access import ResourceAudienceResolver
from uniffy.domains.tags.context import ContentTagMutations

if TYPE_CHECKING:
    from uniffy.domains.notes.operations import NoteOperations

logger = logger.bind(component="notes.hierarchy.operations")

_MAX_TREE_DEPTH = 64


class NoteHierarchy:
    def __init__(
        self,
        operations: NoteOperations,
        buffer: UpdateBuffer | None = None,
        enqueue: Enqueue = enqueue_core,
    ) -> None:
        self.operations = operations
        # Accepted realtime edits that trash keeps and deletion retires.
        self.buffer = buffer or UpdateBuffer()
        self.enqueue = enqueue

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
        # Purging a folder also destroys descendants that were trashed earlier.
        removed_ids = await self.collect_descendant_ids(note, include_deleted=permanent)
        keys = [(ContentType.NOTE, item) for item in removed_ids]
        await lock_documents(self.operations.session, keys)
        # Read before the rows go, so the fanout reaches everyone who could open them.
        audiences = await self._audiences(organization_id, removed_ids)
        tags = None
        staged_tag_removals = []
        settle: list[AfterCommit] = []
        if permanent:
            for key in keys:
                settle.append(await stage_hard_delete(self.buffer, self.operations.session, key))
            tags = ContentTagMutations(
                self.operations.session,
                self.operations.search_indexer,
            )
            for removed_id in removed_ids:
                staged_tag_removals.append(
                    await tags.stage_unassign_all_for_urn(
                        actor_id=user_id,
                        organization_id=organization_id,
                        content_urn=build_content_urn(ContentType.NOTE, removed_id),
                    )
                )
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
            # Trash keeps every accepted edit in the checkpoint so restore can render it.
            for key in keys:
                settle.append(
                    await stage_trash(self.buffer, self.operations.session, key, organization_id)
                )
            await queries.soft_delete_recursive(self.operations.session, note)

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
        for after_commit in settle:
            await after_commit()
        await self._publish_access(organization_id, audiences, ContentAccessAction.REVOKED)
        if tags is not None:
            for staged in staged_tag_removals:
                try:
                    await tags.finish_unassign_all_after_commit(staged)
                except Exception:
                    logger.opt(exception=True).warning(
                        "Note deleted with stale tag projections",
                        note_id=str(note_id),
                    )
        for removed_id in removed_ids:
            try:
                await self.operations.search_indexer.remove(
                    build_content_urn(ContentType.NOTE, removed_id)
                )
            except Exception:
                logger.opt(exception=True).warning(
                    "Note deleted with a stale search projection",
                    note_id=str(removed_id),
                )
        await self.operations._refresh_parent_folder(parent_folder_id, organization_id)
        return True

    async def restore(
        self,
        user_id: UUID,
        organization_id: UUID,
        note_id: UUID,
    ) -> Note:
        key = (ContentType.NOTE, note_id)
        await lock_document(self.operations.session, key)
        note = await self.operations._fetch_by_id(note_id, organization_id)
        if not note:
            raise NotFoundError("Note", note_id)
        await self.operations._require_edit(user_id, organization_id, note)

        note.is_deleted = False
        note.deleted_at = None
        note.updated_at = datetime.now(UTC)
        restored = await stage_restore(
            self.buffer, self.operations.session, key, organization_id, enqueue=self.enqueue
        )
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
        # Edits retained while trashed render through the projection job.
        await restored()
        await self.operations.session.refresh(note)
        await self.operations._index_for_search(note)
        await self.operations.session.commit()
        await self._publish_access(
            organization_id,
            await self._audiences(organization_id, [note_id]),
            ContentAccessAction.GRANTED,
        )
        await self.operations._refresh_parent_folder(note.parent_id, organization_id)
        return note

    async def _audiences(
        self, organization_id: UUID, note_ids: list[UUID]
    ) -> dict[UUID, list[UUID] | None]:
        """Who can open each note; None sends an OPEN_TO_ORG note org-wide, a private id never."""
        session = self.operations.session
        default_mode, default_baseline = await resolve_content_defaults(
            session, organization_id, ContentType.NOTE
        )
        rows = (
            await session.execute(
                select(Note.id, Note.owner_id, Note.access_mode, Note.baseline_role).where(
                    Note.id.in_(note_ids), Note.organization_id == organization_id
                )
            )
        ).all()
        resolver = ResourceAudienceResolver(session)
        audiences: dict[UUID, list[UUID] | None] = {}
        for note_id, owner_id, access_mode, baseline_role in rows:
            mode, _ = resolve_effective_policy(
                access_mode, baseline_role, default_mode, default_baseline
            )
            audiences[note_id] = (
                None
                if mode == AccessMode.OPEN_TO_ORG
                else await resolver.standard_audience(
                    organization_id=organization_id,
                    content_type=ContentType.NOTE,
                    content_id=note_id,
                    owner_id=owner_id,
                    access_mode=access_mode,
                    baseline_role=baseline_role,
                )
            )
        return audiences

    async def _publish_access(
        self,
        organization_id: UUID,
        audiences: dict[UUID, list[UUID] | None],
        action: ContentAccessAction,
    ) -> None:
        """Runs after commit; a failed publish leaves live sessions to their periodic recheck."""
        for note_id, audience in audiences.items():
            try:
                await publish_perm_change(ContentType.NOTE, note_id, None, None)
                await publish_content_access_changed(
                    content_type=content_type_to_proto(ContentType.NOTE),
                    content_id=note_id,
                    action=action,
                    organization_id=organization_id,
                    target_user_ids=audience,
                )
            except Exception:
                logger.opt(exception=True).warning(
                    "Note access change was not published", note_id=str(note_id)
                )

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
        candidates = list(
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
        await lock_documents(
            self.operations.session, [(ContentType.NOTE, item) for item in candidates]
        )
        # A restore that committed before these locks keeps its note and its live state.
        trash_ids = list(
            (
                await self.operations.session.execute(
                    select(Note.id).where(Note.id.in_(candidates), Note.is_deleted.is_(True))
                )
            )
            .scalars()
            .all()
        )
        settle: list[AfterCommit] = []
        for note_id in trash_ids:
            settle.append(
                await stage_hard_delete(
                    self.buffer, self.operations.session, (ContentType.NOTE, note_id)
                )
            )
        await purge_attachments_for_content(
            self.operations.session,
            self.operations.storage,
            self.operations.search_indexer,
            organization_id=organization_id,
            content_type=ContentType.NOTE,
            content_ids=trash_ids,
        )
        tags = ContentTagMutations(
            self.operations.session,
            self.operations.search_indexer,
        )
        staged_tag_removals = []
        for note_id in trash_ids:
            staged_tag_removals.append(
                await tags.stage_unassign_all_for_urn(
                    actor_id=user_id,
                    organization_id=organization_id,
                    content_urn=build_content_urn(ContentType.NOTE, note_id),
                )
            )
        count = await queries.empty_trash(
            self.operations.session,
            organization_id,
            trash_ids,
        )

        for note_id in trash_ids:
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
        for after_commit in settle:
            await after_commit()
        for staged in staged_tag_removals:
            try:
                await tags.finish_unassign_all_after_commit(staged)
            except Exception:
                logger.opt(exception=True).warning(
                    "Trash emptied with stale tag projections",
                    note_id=str(staged.content_urn),
                )
        for note_id in trash_ids:
            try:
                await self.operations.search_indexer.remove(
                    build_content_urn(ContentType.NOTE, note_id)
                )
            except Exception:
                logger.opt(exception=True).warning(
                    "Trash emptied with a stale search projection",
                    note_id=str(note_id),
                )
        return count

    async def collect_descendant_ids(
        self, note: Note, *, include_deleted: bool = False
    ) -> list[UUID]:
        ids = [note.id]
        if note.node_type != NodeType.FOLDER:
            return ids
        query = select(Note).where(Note.parent_id == note.id)
        if not include_deleted:
            query = query.where(Note.is_deleted == False)  # noqa: E712
        children = (await self.operations.session.execute(query)).scalars().all()
        for child in children:
            ids.extend(await self.collect_descendant_ids(child, include_deleted=include_deleted))
        return ids
