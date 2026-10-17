"""Propagate current labels to stored mentions and live realtime documents."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.references import replace_mention_label, replace_mention_label_in_canvas
from uniffy.core.json_codec import dumps_str
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.notes.note import Note
from uniffy.core.models.projects.task import Task
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.buffer import BufferUnavailable, RecoveryRequired, UpdateBuffer
from uniffy.core.realtime.checkpoint import Enqueue, enqueue_core
from uniffy.core.realtime.live import AfterCommit, LiveStateUnavailable
from uniffy.core.realtime.publisher import publish_content_replace
from uniffy.core.realtime.rename import rename_batches, stage_mention_rename
from uniffy.core.realtime.state import DocKey
from uniffy.core.realtime.storage import lock_documents
from uniffy.core.types import ContentType, NodeType, generate_id
from uniffy.domains.search.jobs.contracts import REINDEX_RENAMED_CONTENT
from uniffy.domains.search.metrics import MENTION_RENAME_SKIPPED_TOTAL, RenameSkip

logger = logger.bind(component="domains.search.rename")

_MODELS = {
    ContentType.NOTE: (Note, "content", "note_ids"),
    ContentType.CALENDAR_EVENT: (CalendarEvent, "description", "event_ids"),
    ContentType.TASK: (Task, "description", "task_ids"),
}


async def _candidates(
    session: AsyncSession, organization_id: UUID, target_urn: str, buffered: set[DocKey]
) -> list[DocKey]:
    candidates: list[DocKey] = []
    for kind, (model, _, _) in _MODELS.items():
        # Accepted edits reach outgoing references only when they project, so unprojected
        # snapshots and buffered tails can mention the target before the column does.
        unprojected = select(RealtimeYjsSnapshot.content_id).where(
            RealtimeYjsSnapshot.content_type == kind,
            RealtimeYjsSnapshot.organization_id == organization_id,
            RealtimeYjsSnapshot.revision > RealtimeYjsSnapshot.rendered_revision,
        )
        pending = [content_id for content_type, content_id in buffered if content_type == kind]
        ids = (
            await session.execute(
                select(model.id).where(
                    model.organization_id == organization_id,
                    model.is_deleted.is_(False),
                    or_(
                        model.outgoing_references.contains([target_urn]),
                        model.id.in_(unprojected),
                        model.id.in_(pending),
                    ),
                )
            )
        ).scalars()
        candidates.extend((kind, content_id) for content_id in ids)
    return candidates


async def _stage_document(
    session: AsyncSession,
    key: DocKey,
    organization_id: UUID,
    target_urn: str,
    new_label: str,
    buffer: UpdateBuffer,
    enqueue: Enqueue,
) -> tuple[bool, AfterCommit | None]:
    """Whether the document changed, and the cleanup its live checkpoint needs after commit."""
    model, field, _ = _MODELS[key[0]]
    row = (
        await session.execute(
            select(model)
            .where(
                model.id == key[1],
                model.organization_id == organization_id,
                model.is_deleted.is_(False),
            )
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if row is None:
        return False, None
    settle = await stage_mention_rename(
        buffer, session, key, organization_id, target_urn, new_label, enqueue=enqueue
    )
    if isinstance(row, Note) and row.node_type == NodeType.CANVAS:
        canvas, column_changed = replace_mention_label_in_canvas(
            row.canvas_content or {}, target_urn, new_label
        )
        if column_changed:
            row.canvas_content = canvas
    else:
        source = getattr(row, field) or ""
        renamed = replace_mention_label(source, target_urn, new_label)
        column_changed = renamed != source
        if column_changed:
            setattr(row, field, renamed)
    if not column_changed and settle is None:
        return False, None
    row.updated_at = datetime.now(UTC)
    if isinstance(row, (Note, Task)):
        row.version += 1
    return True, settle


async def _stage_batch(
    session: AsyncSession,
    batch: list[DocKey],
    organization_id: UUID,
    target_urn: str,
    new_label: str,
    buffer: UpdateBuffer,
    enqueue: Enqueue,
) -> tuple[list[DocKey], list[AfterCommit], list[DocKey]]:
    await lock_documents(session, batch)
    changed: list[DocKey] = []
    settles: list[AfterCommit] = []
    skipped: list[DocKey] = []
    for key in batch:
        try:
            # An unverifiable document keeps its old label in the column too; projecting its
            # tail later would bring the old label back anyway.
            async with session.begin_nested():
                renamed, settle = await _stage_document(
                    session, key, organization_id, target_urn, new_label, buffer, enqueue
                )
        except LiveStateUnavailable:
            skipped.append(key)
            continue
        if settle is not None:
            settles.append(settle)
        if renamed:
            changed.append(key)
    return changed, settles, skipped


async def _reindex(organization_id: UUID, changed: list[DocKey], enqueue: Enqueue) -> None:
    ids: dict[str, list[str]] = {name: [] for _, _, name in _MODELS.values()}
    for kind, content_id in changed:
        ids[_MODELS[kind][2]].append(str(content_id))
    payload = dumps_str({"organization_id": str(organization_id), **ids})
    try:
        await enqueue(REINDEX_RENAMED_CONTENT, generate_id().hex, (payload,))
    except Exception:
        logger.opt(exception=True).warning(
            "Renamed content not reindexed", organization_id=str(organization_id)
        )


async def _buffered(buffer: UpdateBuffer, organization_id: UUID) -> set[DocKey]:
    try:
        return await buffer.pending_documents(organization_id)
    except BufferUnavailable, RecoveryRequired:
        # Documents with an epoch then fail one by one; the rest still take the label.
        MENTION_RENAME_SKIPPED_TOTAL.labels(reason=RenameSkip.BUFFER_SCAN).inc()
        logger.opt(exception=True).warning(
            "Rename runs without buffered candidates", organization_id=str(organization_id)
        )
        return set()


async def propagate_rename(
    session: AsyncSession,
    organization_id: UUID,
    target_urn: str,
    new_label: str,
    *,
    buffer: UpdateBuffer,
    enqueue: Enqueue = enqueue_core,
) -> int:
    """Rename ``target_urn`` labels in domain columns and live documents, one batch per commit.

    Live documents take the label together with their buffered tail. A document whose live state
    cannot be verified keeps its old label and is counted; every other document is renamed.
    """
    buffered = await _buffered(buffer, organization_id)
    batches = rename_batches(await _candidates(session, organization_id, target_urn, buffered))
    # Each batch locks and commits in a transaction of its own.
    await session.commit()
    renamed = 0
    for batch in batches:
        # The savepoint keeps a failed batch out of the caller's later commits and leaves the
        # caller's loaded rows unexpired.
        async with session.begin_nested():
            changed, settles, skipped = await _stage_batch(
                session, batch, organization_id, target_urn, new_label, buffer, enqueue
            )
        await session.commit()
        if skipped:
            MENTION_RENAME_SKIPPED_TOTAL.labels(reason=RenameSkip.DOCUMENT).inc(len(skipped))
            logger.warning(
                "Rename left documents with unverifiable live edits unrenamed",
                organization_id=str(organization_id),
                documents=[f"{kind.value}:{content_id}" for kind, content_id in skipped],
            )
        for settle in settles:
            await settle()
        for kind, content_id in changed:
            await publish_content_replace(kind, content_id)
        if changed:
            await _reindex(organization_id, changed, enqueue)
        renamed += len(changed)
    return renamed
