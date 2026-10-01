"""CSV rows for project task exports: fixed columns, the custom field union and cell formatting."""

import csv
import io
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from uniffy.core.models.projects.field_definition import FieldDefinition, ProjectFieldType
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.domains.projects.export.labels import ExportLabels

MAX_EXPORT_ROWS = 200_000
MAX_EXPORT_PROJECTS = 100
EXPORT_BATCH = 1_000
CHUNK_FLUSH_BYTES = 32 * 1024
# Excel reads a CSV as the legacy code page unless the file opens with a byte order mark.
CSV_BOM = "\ufeff"
CUSTOM_COLUMN_PREFIX = "field:"
MULTI_VALUE_SEPARATOR = ";"

TASK_COLUMNS = (
    "project",
    "project_slug",
    "key",
    "title",
    "type",
    "status",
    "priority",
    "assignees",
    "creator_email",
    "start_date",
    "due_date",
    "completed_at",
    "estimated_minutes",
    "time_spent_minutes",
    "sprint",
    "parent_key",
    "depth",
    "is_milestone",
    "blocked_by_keys",
    "tags",
    "created_at",
    "updated_at",
    "description",
)

# A spreadsheet evaluates a cell that starts with one of these as a formula.
_FORMULA_TRIGGERS = ("=", "+", "-", "@", "\t", "\r")


@dataclass(frozen=True)
class CustomColumn:
    """One `field:<name>` column; `field_ids` maps each project that defines it to its field id."""

    header: str
    field_ids: dict[UUID, str]


def safe_text(value: str | None) -> str:
    if not value:
        return ""
    return f"'{value}" if value.startswith(_FORMULA_TRIGGERS) else value


def format_number(value: Any) -> str:
    if value is None or isinstance(value, bool):
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def format_timestamp(value: datetime | None) -> str:
    return value.astimezone(UTC).isoformat() if value else ""


def format_bool(value: bool) -> str:
    return "true" if value else "false"


def join_values(values: Iterable[str]) -> str:
    return MULTI_VALUE_SEPARATOR.join(value for value in values if value)


def as_id_list(value: Any) -> list[str]:
    if value is None or value == "":
        return []
    if isinstance(value, list):
        return [str(item) for item in value if item]
    return [str(value)]


def build_custom_columns(
    projects: Sequence[Project], fields_by_project: dict[UUID, list[FieldDefinition]]
) -> list[CustomColumn]:
    """Union of custom fields by case-insensitive name, in project order then field order.

    A name repeated inside one project gets a ` (2)` suffix so neither field is dropped.
    """
    columns: dict[str, tuple[str, dict[UUID, str]]] = {}
    for project in projects:
        seen: dict[str, int] = {}
        fields = sorted(fields_by_project.get(project.id, []), key=lambda f: f.sort_order)
        for field in fields:
            if field.is_system:
                continue
            base = field.name.strip() or field.id
            occurrence = seen.get(base.casefold(), 0) + 1
            seen[base.casefold()] = occurrence
            name = base if occurrence == 1 else f"{base} ({occurrence})"
            _, field_ids = columns.setdefault(name.casefold(), (name, {}))
            field_ids[project.id] = field.id
    return [
        CustomColumn(header=f"{CUSTOM_COLUMN_PREFIX}{name}", field_ids=field_ids)
        for name, field_ids in columns.values()
    ]


def field_cell(field: FieldDefinition, value: Any, labels: ExportLabels) -> str:
    if value is None or value == "" or value == []:
        return ""
    project_id = field.project_id
    field_type = field.type
    if field_type == ProjectFieldType.NUMBER:
        return format_number(value)
    if field_type == ProjectFieldType.SINGLE_SELECT:
        return safe_text(labels.option_label(project_id, field.id, str(value)))
    if field_type == ProjectFieldType.MULTI_SELECT:
        return safe_text(
            join_values(labels.option_label(project_id, field.id, raw) for raw in as_id_list(value))
        )
    if field_type == ProjectFieldType.PERSON:
        return safe_text(join_values(labels.subject_label(raw) for raw in as_id_list(value)))
    if field_type in (ProjectFieldType.DATE, ProjectFieldType.REFERENCE):
        return str(value)
    return safe_text(str(value))


def task_row(
    task: Task,
    project: Project,
    labels: ExportLabels,
    custom_columns: Sequence[CustomColumn],
) -> list[str]:
    project_id = project.id
    fixed = [
        safe_text(project.name),
        project.slug,
        labels.key(project.slug, task.number),
        safe_text(task.title),
        labels.task_type_label(task.task_type),
        safe_text(labels.status_label(project_id, task.status)),
        safe_text(labels.priority_label(project_id, task.priority)),
        safe_text(join_values(labels.subject_label(raw) for raw in task.assignee_ids or [])),
        labels.email(task.owner_id),
        task.start_date or "",
        task.due_date or "",
        format_timestamp(task.completed_at),
        format_number(task.estimated_minutes),
        format_number(task.time_spent_minutes),
        safe_text(labels.sprint_name(task.sprint_id)),
        labels.task_key(task.parent_id),
        str(labels.depth(task.id)),
        format_bool(task.is_milestone),
        join_values(labels.task_key_from_text(raw) for raw in task.blocked_by_task_ids or []),
        safe_text(join_values(labels.tags(task.id))),
        format_timestamp(task.created_at),
        format_timestamp(task.updated_at),
        safe_text(task.description),
    ]
    values = task.field_values or {}
    for column in custom_columns:
        field_id = column.field_ids.get(project_id)
        field = labels.field(project_id, field_id) if field_id else None
        fixed.append(field_cell(field, values.get(field.id), labels) if field else "")
    return fixed


class CsvChunker:
    """A CSV writer that hands back UTF-8 chunks once roughly `CHUNK_FLUSH_BYTES` accumulate."""

    def __init__(self) -> None:
        self._buffer = io.StringIO()
        self._writer = csv.writer(self._buffer, lineterminator="\r\n")

    def header(self, columns: Sequence[str]) -> bytes | None:
        self._buffer.write(CSV_BOM)
        return self.row(columns)

    def row(self, values: Sequence[str]) -> bytes | None:
        self._writer.writerow(values)
        if self._buffer.tell() >= CHUNK_FLUSH_BYTES:
            return self._take()
        return None

    def flush(self) -> bytes | None:
        return self._take() if self._buffer.tell() > 0 else None

    def _take(self) -> bytes:
        chunk = self._buffer.getvalue().encode("utf-8")
        self._buffer.seek(0)
        self._buffer.truncate(0)
        return chunk
