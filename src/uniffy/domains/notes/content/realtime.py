"""Persist rendered realtime note snapshots."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy import update as sql_update

from uniffy.core.events import NotificationEvent, emit_notification
from uniffy.core.events.bus import stage_notification_events
from uniffy.core.models.notes.note import Note
from uniffy.core.realtime.adapter import RealtimeRenderConflict
from uniffy.core.realtime.metrics import REALTIME_BLANK_CONTENT_OVERWRITES_TOTAL
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import AccessMode, ContentType, NodeType, NotificationType
from uniffy.domains.files.attachments.inline import stage_inline_reconciliation
from uniffy.domains.notes.content.fields import extract_content_fields
from uniffy.domains.tags.sync import finish_inline_tags_after_commit, stage_inline_tags

if TYPE_CHECKING:
    from uniffy.domains.notes.operations import NoteOperations

logger = logger.bind(component="notes.content.realtime")


class NoteRealtimePersistence:
    def __init__(self, operations: NoteOperations) -> None:
        self.operations = operations

    async def stage_save(
        self,
        organization_id: UUID,
        note_id: UUID,
        content: str,
        canvas_content: dict[str, Any] | None,
        *,
        actor_id: UUID | None = None,
    ) -> tuple[Note, Callable[[], Awaitable[None]]] | None:
        note = await self._load_note(organization_id, note_id)
        if not note:
            return None

        fields = extract_content_fields(
            note.node_type,
            content,
            canvas_content,
            organization_id,
        )
        if note.content and not fields.content:
            REALTIME_BLANK_CONTENT_OVERWRITES_TOTAL.labels(content_type=ContentType.NOTE.value).inc()
            logger.warning(
                "Realtime save is replacing non-empty note content with empty content",
                note_id=str(note_id),
                organization_id=str(organization_id),
                old_content_length=len(note.content),
            )

        for attempt in range(3):
            if attempt:
                note = await self._load_note(
                    organization_id,
                    note_id,
                    populate_existing=True,
                )
                if not note:
                    return None

            old_refs = note.outgoing_references
            content_changed = (
                note.content != fields.content or note.canvas_content != fields.canvas_content
            )
            if (
                note.node_type != NodeType.CANVAS
                and not content_changed
                and (note.outgoing_references or []) == (fields.outgoing_references or [])
            ):

                async def refresh_projection() -> None:
                    await self.after_projection(organization_id, note_id)

                return note, refresh_projection
            result = await self.operations.session.execute(
                sql_update(Note)
                .where(
                    Note.id == note_id,
                    Note.organization_id == organization_id,
                    Note.is_deleted == False,  # noqa: E712
                    Note.version == note.version,
                )
                .values(
                    content=fields.content,
                    canvas_content=fields.canvas_content,
                    outgoing_references=fields.outgoing_references,
                    version=note.version + 1,
                    updated_at=datetime.now(UTC),
                )
                .execution_options(synchronize_session=False)
            )
            if result.rowcount:
                break
        else:
            logger.warning(
                "Realtime save lost the version CAS after 3 attempts",
                note_id=str(note_id),
                organization_id=str(organization_id),
            )
            raise RealtimeRenderConflict(f"Note {note_id} remained contended after three attempts")

        await self.operations.session.refresh(note)
        # The last live editor stands in for the missing request actor, else the owner.
        actor_id = actor_id or note.owner_id
        tags = await stage_inline_tags(
            self.operations.session,
            content_urn=build_content_urn(ContentType.NOTE, note.id),
            actor_id=actor_id,
            organization_id=organization_id,
            parsed_names=fields.parsed_inline_tag_names or [],
        )

        await stage_inline_reconciliation(
            self.operations.session, ContentType.NOTE, note_id, organization_id
        )
        with stage_notification_events(self.operations.session):
            await self.operations._notify_new_mentions(
                actor_id,
                organization_id,
                note,
                old_refs=old_refs,
                writer_id=actor_id,
            )
            effective_mode, _ = await self.operations._effective_policy(organization_id, note)
            if content_changed and effective_mode != AccessMode.OWNER_ONLY:
                await emit_notification(
                    NotificationEvent(
                        notification_type=NotificationType.CONTENT_EDITED,
                        organization_id=organization_id,
                        actor_id=actor_id,
                        title=f"Edited note: {note.title}",
                        source_urn=build_content_urn(ContentType.NOTE, note.id),
                        content_type=ContentType.NOTE,
                        content_id=note.id,
                    )
                )

        async def after_commit() -> None:
            await finish_inline_tags_after_commit(tags)
            await self.after_projection(organization_id, note_id)

        return note, after_commit

    async def after_projection(self, organization_id: UUID, note_id: UUID) -> None:
        note = await self._load_note(organization_id, note_id, populate_existing=True)
        if note is not None:
            await self.operations._index_for_search(note)

    async def _load_note(
        self,
        organization_id: UUID,
        note_id: UUID,
        *,
        populate_existing: bool = False,
    ) -> Note | None:
        query = select(Note).where(
            Note.id == note_id,
            Note.organization_id == organization_id,
            Note.is_deleted == False,  # noqa: E712
        )
        if populate_existing:
            query = query.execution_options(populate_existing=True)
        return (await self.operations.session.execute(query)).scalar_one_or_none()
