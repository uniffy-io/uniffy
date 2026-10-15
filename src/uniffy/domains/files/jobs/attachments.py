"""Reconcile inline uploads against current projected content after commit."""

from datetime import UTC, datetime, timedelta
from typing import Any, cast

from loguru import logger
from sqlalchemy import func, select

from uniffy.core.content.references import parse_urn
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.files.attachment import Attachment
from uniffy.core.models.files.reconciliation import InlineAttachmentReconciliation
from uniffy.core.models.notes.note import Note
from uniffy.core.models.projects.task import Task
from uniffy.core.realtime.metrics import REALTIME_BACKLOG_DEPTH
from uniffy.core.realtime.storage import load_snapshot, lock_document
from uniffy.core.search.indexer import SEARCH_INDEXER_CTX_KEY, SearchIndexer
from uniffy.core.storage import OBJECT_STORAGE_CTX_KEY, ObjectStorage
from uniffy.core.types import ContentType
from uniffy.domains.files.attachments.inline import reconcile_inline_attachments
from uniffy.infrastructure.database.session import open_session

logger = logger.bind(component="files.jobs.attachments")

INLINE_UPLOAD_GRACE = timedelta(hours=24)


async def reconcile_pending_inline_attachments(ctx: dict[str, Any]) -> None:
    async with open_session() as db:
        depth = await db.scalar(select(func.count()).select_from(InlineAttachmentReconciliation))
        REALTIME_BACKLOG_DEPTH.labels(kind="inline_attachments").set(depth or 0)
        pending = (
            (
                await db.execute(
                    select(InlineAttachmentReconciliation)
                    .order_by(InlineAttachmentReconciliation.attempted_at)
                    .limit(100)
                    .with_for_update(skip_locked=True)
                )
            )
            .scalars()
            .all()
        )
        for item in pending:
            item.attempted_at = datetime.now(UTC)
        await db.commit()
    for item in pending:
        try:
            await _reconcile(ctx, item)
        except Exception:
            logger.exception(
                "Inline attachment reconciliation failed", content_id=str(item.content_id)
            )


async def _reconcile(ctx: dict[str, Any], item: InlineAttachmentReconciliation) -> None:
    kind = ContentType(item.content_type)
    models = {
        ContentType.NOTE: Note,
        ContentType.TASK: Task,
        ContentType.CALENDAR_EVENT: CalendarEvent,
    }
    model = models[kind]
    async with open_session() as db:
        await lock_document(db, (kind, item.content_id), item.organization_id)
        pending = await db.get(InlineAttachmentReconciliation, (item.content_type, item.content_id))
        if pending is None:
            return
        snapshot = await load_snapshot(db, (kind, item.content_id))
        if snapshot is not None and snapshot.revision > snapshot.rendered_revision:
            return
        content = (
            await db.execute(
                select(model).where(
                    model.id == item.content_id,
                    model.organization_id == item.organization_id,
                )
            )
        ).scalar_one_or_none()
        if content is not None and content.is_deleted and kind == ContentType.NOTE:
            return
        if content is not None and content.is_deleted:
            await db.delete(pending)
            await db.commit()
            return
        references = content.outgoing_references if content is not None else []
        ids = {
            parsed[1]
            for urn in references or []
            if (parsed := parse_urn(urn)) and parsed[0] == ContentType.FILE
        }
        # Upload completion can precede the editor transaction carrying its reference.
        recent_upload = await db.scalar(
            select(Attachment.id)
            .where(
                Attachment.organization_id == item.organization_id,
                Attachment.content_type == kind,
                Attachment.content_id == item.content_id,
                Attachment.source_file_id == Attachment.file_id,
                Attachment.file_id.not_in(ids),
                Attachment.attached_at > datetime.now(UTC) - INLINE_UPLOAD_GRACE,
            )
            .limit(1)
        )
        if recent_upload is not None:
            return
        await reconcile_inline_attachments(
            db,
            cast(ObjectStorage, ctx[OBJECT_STORAGE_CTX_KEY]),
            cast(SearchIndexer, ctx[SEARCH_INDEXER_CTX_KEY]),
            organization_id=item.organization_id,
            content_type=kind,
            content_id=item.content_id,
            referenced_file_ids=ids,
        )
        await db.delete(pending)
        await db.commit()
