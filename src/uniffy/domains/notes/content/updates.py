"""Note content and metadata updates."""

from __future__ import annotations

import copy
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import delete as sql_delete
from sqlalchemy import select
from sqlalchemy import update as sql_update

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import ConflictError, NotFoundError
from uniffy.core.events import NotificationEvent, emit_notification
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.notes.note import Note
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.publisher import publish_content_replace
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import AccessMode, ContentType, NodeType, NotificationType
from uniffy.domains.files.attachments.inline import reconcile_inline_attachments
from uniffy.domains.notes.content.fields import extract_content_fields, referenced_file_ids
from uniffy.domains.tags.context import ContentTagContext
from uniffy.domains.tags.sync import sync_inline_tags

if TYPE_CHECKING:
    from uniffy.domains.notes.operations import NoteOperations


class NoteUpdates:
    def __init__(self, operations: NoteOperations) -> None:
        self.operations = operations

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
        note = await self.operations._fetch_by_id(note_id, organization_id)
        if not note:
            raise NotFoundError("Note", note_id)
        await self.operations._require_edit(user_id, organization_id, note)

        if isinstance(parent_id, UUID):
            await self.operations._require_moveable_under(note_id, parent_id, organization_id)

        is_canvas = note.node_type == NodeType.CANVAS
        content_changed = canvas_content is not None if is_canvas else content is not None
        fields = (
            extract_content_fields(
                note.node_type,
                content or "",
                canvas_content,
                organization_id,
            )
            if content_changed
            else None
        )
        parsed_inline_names = fields.parsed_inline_tag_names if fields else None
        title_changed = False
        old_refs: list[str] | None = None
        previous_parent_id = note.parent_id
        parent_changed = False

        for attempt in range(3):
            if attempt:
                refreshed = (
                    await self.operations.session.execute(
                        select(Note)
                        .where(
                            Note.id == note_id,
                            Note.organization_id == organization_id,
                        )
                        .execution_options(populate_existing=True)
                    )
                ).scalar_one_or_none()
                if refreshed is None:
                    raise NotFoundError("Note", note_id)
                note = refreshed

            title_changed = title is not None and title != note.title
            old_refs = note.outgoing_references if content_changed else None
            previous_parent_id = note.parent_id
            parent_changed = False
            values: dict[str, Any] = {"updated_at": datetime.now(UTC)}
            if title is not None:
                values["title"] = title
            if fields is not None:
                values.update(
                    content=fields.content,
                    canvas_content=fields.canvas_content,
                    outgoing_references=fields.outgoing_references,
                    version=note.version + 1,
                )
            if slug is not None:
                values["slug"] = slug
            if parent_id == "":
                parent_changed = note.parent_id is not None
                values["parent_id"] = None
            elif parent_id is not None:
                parent_changed = note.parent_id != parent_id
                values["parent_id"] = parent_id
            if metadata is not None:
                merged = copy.deepcopy(note.note_metadata) if note.note_metadata else {}
                merged.update(metadata)
                values["note_metadata"] = merged

            result = await self.operations.session.execute(
                sql_update(Note)
                .where(
                    Note.id == note_id,
                    Note.organization_id == organization_id,
                    Note.version == note.version,
                )
                .values(**values)
                .execution_options(synchronize_session=False)
            )
            if result.rowcount:
                if content_changed:
                    await self.operations.session.execute(
                        sql_delete(RealtimeYjsSnapshot).where(
                            RealtimeYjsSnapshot.content_type == ContentType.NOTE,
                            RealtimeYjsSnapshot.content_id == note_id,
                        )
                    )
                if parent_changed:
                    await write_audit_event(
                        self.operations.session,
                        organization_id=organization_id,
                        actor_user_id=user_id,
                        action=Action.NOTE_MOVED,
                        resource_type=AuditResourceType.NOTE,
                        resource_id=note.id,
                        details={
                            "previous_parent_id": (
                                str(previous_parent_id) if previous_parent_id else None
                            ),
                            "new_parent_id": (None if parent_id == "" else str(parent_id)),
                        },
                    )
                await self.operations.session.commit()
                break
            await self.operations.session.rollback()
        else:
            raise ConflictError("Note", f"concurrent edits on {note_id}")

        await self.operations.session.refresh(note)
        if content_changed and not is_canvas and fields is not None:
            await publish_content_replace(ContentType.NOTE, note_id, fields.content)

        if content_changed and fields is not None:
            await reconcile_inline_attachments(
                self.operations.session,
                organization_id=organization_id,
                content_type=ContentType.NOTE,
                content_id=note_id,
                referenced_file_ids=referenced_file_ids(fields.outgoing_references),
            )
            await self.operations.session.commit()

        await self.operations._sync_tags_after_save(
            user_id=user_id,
            organization_id=organization_id,
            note=note,
            tag_ids=tag_ids,
            parsed_inline_names=parsed_inline_names if content_changed else None,
        )
        await self.operations._index_for_search(note)
        await self.operations.session.commit()

        if title_changed:
            await self.operations._propagate_title_to_mentions(organization_id, note)
            if note.node_type == NodeType.FOLDER:
                await self.operations._refresh_children_parent_label(note)
        if parent_changed:
            await self.operations._refresh_parent_folder(previous_parent_id, organization_id)
            await self.operations._refresh_parent_folder(note.parent_id, organization_id)

        effective_mode, _ = await self.operations._effective_policy(organization_id, note)
        if effective_mode != AccessMode.OWNER_ONLY:
            await emit_notification(
                NotificationEvent(
                    notification_type=NotificationType.CONTENT_EDITED,
                    organization_id=organization_id,
                    actor_id=user_id,
                    title=f"Edited note: {note.title}",
                    source_urn=build_content_urn(ContentType.NOTE, note.id),
                    content_type=ContentType.NOTE,
                    content_id=note.id,
                )
            )
        if content_changed:
            await self.operations._notify_new_mentions(
                user_id,
                organization_id,
                note,
                old_refs=old_refs,
                writer_id=user_id,
            )
        return note

    async def sync_tags_after_save(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        note: Note,
        tag_ids: list[UUID] | None,
        parsed_inline_names: list[str] | None,
    ) -> None:
        urn = build_content_urn(ContentType.NOTE, note.id)
        if tag_ids is not None:
            await ContentTagContext(self.operations.session).replace_manual_tags(
                actor_id=user_id,
                organization_id=organization_id,
                content_urn=urn,
                tag_ids=tag_ids,
            )
        if parsed_inline_names is not None:
            await sync_inline_tags(
                self.operations.session,
                content_urn=urn,
                organization_id=organization_id,
                actor_id=user_id,
                parsed_names=parsed_inline_names,
            )
