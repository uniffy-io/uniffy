"""Note content and metadata updates."""

from __future__ import annotations

import copy
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy import update as sql_update

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import ConflictError, NotFoundError, StaleContentVersionError
from uniffy.core.events import NotificationEvent, emit_notification
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.notes.note import Note
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.realtime.lifecycle import stage_replacement
from uniffy.core.realtime.limits import validate_document_size
from uniffy.core.realtime.live import (
    AfterCommit,
    has_unprojected_content,
    stage_text_merge,
)
from uniffy.core.realtime.publisher import publish_content_replace
from uniffy.core.realtime.storage import lock_document
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import AccessMode, ContentType, NodeType, NotificationType
from uniffy.domains.files.attachments.inline import stage_inline_reconciliation
from uniffy.domains.notes.content.fields import NoteContentFields, extract_content_fields

if TYPE_CHECKING:
    from uniffy.domains.notes.operations import NoteOperations


class NoteUpdates:
    def __init__(self, operations: NoteOperations, buffer: UpdateBuffer) -> None:
        self.operations = operations
        self.buffer = buffer

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
        base_content: str | None = None,
    ) -> Note:
        session = self.operations.session
        key = (ContentType.NOTE, note_id)
        try:
            await lock_document(session, key)
            note = await self.operations._fetch_by_id(note_id, organization_id)
            if not note:
                raise NotFoundError("Note", note_id)

            await session.refresh(note)
            content_write_requested = content is not None or canvas_content is not None
            guarded_version = expected_content_version if content_write_requested else None
            if guarded_version is not None:
                refreshed = (
                    await session.execute(
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

            await self.operations._require_edit(user_id, organization_id, note)
            if guarded_version is not None:
                # Buffered edits count too: the caller's version cannot have seen them.
                if await has_unprojected_content(self.buffer, session, key):
                    raise StaleContentVersionError(
                        "Note", "newer realtime content is awaiting projection"
                    )
                if note.version != guarded_version:
                    raise StaleContentVersionError(
                        "Note",
                        f"content version {guarded_version} is stale; "
                        f"current version is {note.version}",
                    )
            if isinstance(parent_id, UUID):
                await self.operations._require_moveable_under(note_id, parent_id, organization_id)

            is_canvas = note.node_type == NodeType.CANVAS
            if not is_canvas and content is not None:
                validate_document_size(content)
            content_changed = canvas_content is not None if is_canvas else content is not None
            fields: NoteContentFields | None = None
            title_changed = False
            old_refs: list[str] | None = None
            previous_parent_id = note.parent_id
            parent_changed = False
            after_commit: AfterCommit | None = None

            attempts = 1 if guarded_version is not None else 3
            for attempt in range(attempts):
                if attempt:
                    await lock_document(session, key)
                    refreshed = (
                        await session.execute(
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
                after_commit = None
                if content_changed:
                    stored_content = content or ""
                    if not is_canvas:
                        merge = await stage_text_merge(
                            self.buffer,
                            session,
                            key,
                            organization_id,
                            user_id,
                            base=(note.content or "")
                            if guarded_version is not None
                            else base_content,
                            stored=note.content or "",
                            incoming=stored_content,
                        )
                        stored_content = merge.text
                        after_commit = merge.after_commit
                    fields = extract_content_fields(
                        note.node_type, stored_content, canvas_content, organization_id
                    )
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
                    merged_metadata = copy.deepcopy(note.note_metadata) if note.note_metadata else {}
                    merged_metadata.update(metadata)
                    values["note_metadata"] = merged_metadata

                result = await session.execute(
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
                    if content_changed and is_canvas:
                        after_commit = await stage_replacement(
                            self.buffer, session, key, organization_id
                        )
                    if content_changed:
                        # Uncheckpointed edits may still reference an upload this text lacks;
                        # the sweep decides under the document lock.
                        await stage_inline_reconciliation(
                            session, ContentType.NOTE, note_id, organization_id
                        )
                    if parent_changed:
                        await write_audit_event(
                            session,
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
                    await session.commit()
                    break
                await session.rollback()
            else:
                if guarded_version is not None:
                    raise StaleContentVersionError(
                        "Note",
                        f"content changed after version {guarded_version} was read",
                    )
                raise ConflictError("Note", f"concurrent edits on {note_id}")
        except Exception:
            # Release the document lock and drop staged rows; a shared session must not
            # commit them later.
            await session.rollback()
            raise

        if after_commit is not None:
            await after_commit()
        await self.operations.session.refresh(note)
        parsed_inline_names = fields.parsed_inline_tag_names if fields is not None else None
        if content_changed and fields is not None:
            await publish_content_replace(ContentType.NOTE, note_id)

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
            await self.operations._propagate_title_to_mentions(organization_id, note, self.buffer)
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
