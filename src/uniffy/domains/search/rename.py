"""Propagate current labels to stored mentions and committed realtime documents."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.references import replace_mention_label, replace_mention_label_in_canvas
from uniffy.core.jobs import enqueue_job
from uniffy.core.json_codec import dumps_str
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.notes.note import Note
from uniffy.core.models.projects.task import Task
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.publisher import publish_content_replace
from uniffy.core.realtime.rename import stage_mention_rename
from uniffy.core.realtime.storage import lock_documents
from uniffy.core.types import ContentType, NodeType
from uniffy.domains.search.jobs.contracts import REINDEX_RENAMED_CONTENT


async def propagate_rename(
    session: AsyncSession, organization_id: UUID, target_urn: str, new_label: str
) -> int:
    models = {
        ContentType.NOTE: (Note, "content", "note_ids"),
        ContentType.CALENDAR_EVENT: (CalendarEvent, "description", "event_ids"),
        ContentType.TASK: (Task, "description", "task_ids"),
    }
    candidates = []
    for kind, (model, _, _) in models.items():
        pending = select(RealtimeYjsSnapshot.content_id).where(
            RealtimeYjsSnapshot.content_type == kind,
            RealtimeYjsSnapshot.organization_id == organization_id,
            RealtimeYjsSnapshot.revision > RealtimeYjsSnapshot.rendered_revision,
        )
        ids = (
            await session.execute(
                select(model.id).where(
                    model.organization_id == organization_id,
                    model.is_deleted.is_(False),
                    or_(model.outgoing_references.contains([target_urn]), model.id.in_(pending)),
                )
            )
        ).scalars()
        candidates.extend((kind, content_id) for content_id in ids)
    await lock_documents(session, candidates)
    changed = []
    payload = {
        "organization_id": str(organization_id),
        "note_ids": [],
        "event_ids": [],
        "task_ids": [],
    }
    for kind, content_id in candidates:
        model, field, payload_key = models[kind]
        row = (
            await session.execute(
                select(model)
                .where(
                    model.id == content_id,
                    model.organization_id == organization_id,
                    model.is_deleted.is_(False),
                )
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if row is None:
            continue
        live_changed = await stage_mention_rename(
            session, (kind, content_id), organization_id, target_urn, new_label
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
        if column_changed or live_changed:
            row.updated_at = datetime.now(UTC)
            if isinstance(row, (Note, Task)):
                row.version += 1
            changed.append((kind, content_id))
            payload[payload_key].append(str(content_id))
    await session.commit()
    for kind, content_id in changed:
        await publish_content_replace(kind, content_id, "")
    if changed:
        await enqueue_job(REINDEX_RENAMED_CONTENT, dumps_str(payload))
    return len(changed)
