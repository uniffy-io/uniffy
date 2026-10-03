"""Zip bundle of a project export: tasks plus sprints, activity, comments and field definitions."""

import io
import zipfile
from collections.abc import AsyncIterator, Buffer, Sequence
from uuid import UUID

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.json_codec import dumps_str
from uniffy.core.models.projects.activity import TaskActivity
from uniffy.core.models.projects.field_definition import SystemProjectFieldId
from uniffy.core.models.projects.task import Task
from uniffy.core.types import ContentType
from uniffy.domains.comments.export import stream_comment_rows
from uniffy.domains.projects.export.labels import ExportLabels, parse_ids
from uniffy.domains.projects.export.plan import ExportPlan
from uniffy.domains.projects.export.rows import (
    EXPORT_BATCH,
    CsvChunker,
    format_bool,
    format_timestamp,
    join_values,
    safe_text,
)

SPRINT_COLUMNS = ("id", "project", "name", "goal", "status", "start_date", "end_date")
ACTIVITY_COLUMNS = (
    "task_key",
    "actor_email",
    "action",
    "field",
    "previous_value",
    "new_value",
    "timestamp",
)
COMMENT_COLUMNS = ("task_key", "author_email", "body", "created_at", "resolved")
FIELD_COLUMNS = ("project", "field_id", "name", "type", "required", "options")

# Activity values store comma-joined subject ids for assignment changes.
_ASSIGNEE_SEPARATOR = ","


class _ZipSink(io.RawIOBase):
    """Write-only and unseekable, so `zipfile` streams entries with data descriptors."""

    def __init__(self) -> None:
        super().__init__()
        self._pending = bytearray()

    def writable(self) -> bool:
        return True

    def write(self, b: Buffer, /) -> int:
        view = memoryview(b)
        self._pending.extend(view)
        return view.nbytes

    def drain(self) -> bytes:
        data = bytes(self._pending)
        self._pending.clear()
        return data


async def stream_bundle(
    session: AsyncSession,
    plan: ExportPlan,
    labels: ExportLabels,
    tasks_csv: AsyncIterator[bytes],
    task_ids: Select,
) -> AsyncIterator[bytes]:
    """Keep secondary files within the task IDs and snapshot of tasks.csv."""
    members: Sequence[tuple[str, AsyncIterator[bytes]]] = (
        ("tasks.csv", tasks_csv),
        ("sprints.csv", _sprints_csv(plan, labels)),
        ("activities.csv", _activities_csv(session, labels, task_ids)),
        ("comments.csv", _comments_csv(session, plan, labels, task_ids)),
        ("fields.csv", _fields_csv(plan, labels)),
    )
    sink = _ZipSink()
    with zipfile.ZipFile(sink, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, chunks in members:
            with archive.open(name, "w", force_zip64=True) as entry:
                async for chunk in chunks:
                    entry.write(chunk)
                    if data := sink.drain():
                        yield data
            if data := sink.drain():
                yield data
    if data := sink.drain():
        yield data


async def _sprints_csv(plan: ExportPlan, labels: ExportLabels) -> AsyncIterator[bytes]:
    chunker = CsvChunker()
    if chunk := chunker.header(SPRINT_COLUMNS):
        yield chunk
    for project in plan.projects:
        for sprint in labels.sprints(project.id):
            row = (
                str(sprint.id),
                safe_text(project.name),
                safe_text(sprint.name),
                safe_text(sprint.goal),
                safe_text(str(sprint.status)),
                safe_text(sprint.start_date),
                safe_text(sprint.end_date),
            )
            if chunk := chunker.row(row):
                yield chunk
    if chunk := chunker.flush():
        yield chunk


async def _activities_csv(
    session: AsyncSession, labels: ExportLabels, task_ids: Select
) -> AsyncIterator[bytes]:
    chunker = CsvChunker()
    if chunk := chunker.header(ACTIVITY_COLUMNS):
        yield chunk
    query = (
        select(TaskActivity, Task.project_id, Task.number)
        .join(Task, Task.id == TaskActivity.task_id)
        .where(TaskActivity.task_id.in_(task_ids))
        .order_by(TaskActivity.task_id, TaskActivity.timestamp, TaskActivity.id)
    )
    rows = await session.stream(query.execution_options(yield_per=EXPORT_BATCH))
    try:
        async for partition in rows.partitions(EXPORT_BATCH):
            subjects: set[str] = set()
            for activity, _, _ in partition:
                subjects.add(str(activity.actor_id))
                if activity.field_id == SystemProjectFieldId.ASSIGNEE:
                    for value in (activity.previous_value, activity.new_value):
                        subjects.update((value or "").split(_ASSIGNEE_SEPARATOR))
            await labels.load_subjects(subjects)
            for activity, project_id, number in partition:
                field_id = activity.field_id
                before, after = activity.previous_value, activity.new_value
                row = (
                    safe_text(labels.key(labels.slug(project_id), number)),
                    safe_text(labels.email(activity.actor_id)),
                    safe_text(activity.action),
                    safe_text(labels.field_name(project_id, field_id)),
                    safe_text(_activity_value(labels, project_id, field_id, before)),
                    safe_text(_activity_value(labels, project_id, field_id, after)),
                    format_timestamp(activity.timestamp),
                )
                if chunk := chunker.row(row):
                    yield chunk
    finally:
        await rows.close()
    if chunk := chunker.flush():
        yield chunk


def _activity_value(
    labels: ExportLabels, project_id: UUID, field_id: str | None, raw: str | None
) -> str:
    if not raw:
        return ""
    if field_id == SystemProjectFieldId.STATUS:
        return labels.status_label(project_id, raw)
    if field_id == SystemProjectFieldId.PRIORITY:
        return labels.priority_label(project_id, raw)
    if field_id == SystemProjectFieldId.TYPE:
        return labels.task_type_label(raw)
    if field_id == SystemProjectFieldId.ASSIGNEE:
        return join_values(labels.subject_label(part) for part in raw.split(_ASSIGNEE_SEPARATOR))
    if field_id is None and parse_ids([raw]):
        # Sprint moves are the activity that stores a bare id with no field.
        return labels.sprint_name(raw) or raw
    return raw


async def _comments_csv(
    session: AsyncSession, plan: ExportPlan, labels: ExportLabels, task_ids: Select
) -> AsyncIterator[bytes]:
    chunker = CsvChunker()
    if chunk := chunker.header(COMMENT_COLUMNS):
        yield chunk
    batches = stream_comment_rows(session, plan.request.organization_id, ContentType.TASK, task_ids)
    async for batch in batches:
        await labels.load_subjects(row.author_id for row in batch)
        await labels.load_task_keys(row.content_id for row in batch)
        for comment in batch:
            row = (
                safe_text(labels.task_key(comment.content_id)),
                safe_text(labels.email(comment.author_id)),
                safe_text(comment.body),
                format_timestamp(comment.created_at),
                format_bool(comment.is_resolved),
            )
            if chunk := chunker.row(row):
                yield chunk
    if chunk := chunker.flush():
        yield chunk


async def _fields_csv(plan: ExportPlan, labels: ExportLabels) -> AsyncIterator[bytes]:
    chunker = CsvChunker()
    if chunk := chunker.header(FIELD_COLUMNS):
        yield chunk
    for project in plan.projects:
        for field in labels.fields(project.id):
            options = [
                str(option.get("label") or option.get("id", ""))
                for option in (field.config or {}).get("options", [])
                if isinstance(option, dict)
            ]
            row = (
                safe_text(project.name),
                safe_text(field.id),
                safe_text(field.name),
                str(field.type),
                format_bool(field.is_required),
                dumps_str(options) if options else "",
            )
            if chunk := chunker.row(row):
                yield chunk
    if chunk := chunker.flush():
        yield chunk
