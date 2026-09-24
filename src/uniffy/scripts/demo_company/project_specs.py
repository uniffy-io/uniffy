"""Project, sprint, custom field and task specs, and the hand-written projects.json reader."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from uniffy.core.json_codec import dumps_str
from uniffy.core.models.projects.field_definition import ProjectFieldType
from uniffy.core.models.projects.task import TaskType

FieldValue = str | int | float | tuple[str, ...]
MAX_TASKS_PER_SERIES = 5000


class ProjectContentError(ValueError):
    """A projects content file is malformed."""


@dataclass(frozen=True)
class FieldSpec:
    name: str
    field_type: ProjectFieldType
    options: tuple[str, ...] = ()


@dataclass(frozen=True)
class SprintSpec:
    name: str
    goal: str
    start_in_days: int
    end_in_days: int


@dataclass(frozen=True)
class TaskSpec:
    """Day offsets count from the seeding day; `parent` and `blocked_by` name earlier task keys.

    Custom field values are keyed by field name. Selects hold option labels, person fields
    hold emails and date fields hold a day offset.
    """

    title: str
    description: str = ""
    status: str = "status_todo"
    priority: str = "priority_medium"
    task_type: str = TaskType.TASK
    start_in_days: int | None = None
    due_in_days: int | None = None
    assignees: tuple[str, ...] = ()
    key: str | None = None
    parent: str | None = None
    blocked_by: tuple[str, ...] = ()
    is_milestone: bool = False
    sprint: str | None = None
    estimated_minutes: int | None = None
    time_spent_minutes: int | None = None
    tags: tuple[str, ...] = ()
    field_values: tuple[tuple[str, FieldValue], ...] = ()
    recurrence_rule: str | None = None
    created_in_days: int | None = None
    completed_in_days: int | None = None


@dataclass(frozen=True)
class RecurringSpec:
    title: str
    pattern: str


@dataclass(frozen=True)
class SeriesTemplate:
    name: str
    slug: str
    description: str
    color: str
    icon: str
    tags: tuple[str, ...]
    task_count: int
    start_in_days: int
    end_in_days: int
    sprint_days: int
    sprint_goals: tuple[str, ...]
    team: tuple[str, ...]
    task_tags: tuple[str, ...]
    fields: tuple[FieldSpec, ...]
    field_samples: dict[str, tuple[str | int | float, ...]]
    epics: tuple[str, ...]
    stories: tuple[str, ...]
    bugs: tuple[str, ...]
    subtasks: tuple[str, ...]
    descriptions: tuple[str, ...]
    acceptance: tuple[str, ...]
    variables: dict[str, tuple[str, ...]]
    milestones: tuple[str, ...]
    recurring: tuple[RecurringSpec, ...]


@dataclass(frozen=True)
class ProjectSpec:
    name: str
    slug: str
    description: str
    color: str
    icon: str
    tags: tuple[str, ...]
    tasks: tuple[TaskSpec, ...]
    fields: tuple[FieldSpec, ...] = ()
    sprints: tuple[SprintSpec, ...] = ()
    created_in_days: int | None = None


def load_projects(path: Path, raw: object) -> tuple[ProjectSpec, ...]:
    if not isinstance(raw, list):
        raise ProjectContentError(f"{path.name} must hold a JSON array")

    projects: list[ProjectSpec] = []
    for entry in raw:
        for key in ("name", "slug"):
            if not entry.get(key):
                raise ProjectContentError(f"{path.name}: every project needs '{key}'")

        fields = tuple(field_spec(path, field) for field in entry.get("fields", []))
        sprints = tuple(
            SprintSpec(
                name=sprint["name"],
                goal=sprint.get("goal", ""),
                start_in_days=sprint["start_in_days"],
                end_in_days=sprint["end_in_days"],
            )
            for sprint in entry.get("sprints", [])
        )
        tasks = tuple(_task_spec(path, task) for task in entry.get("tasks", []))
        project = ProjectSpec(
            name=entry["name"],
            slug=entry["slug"],
            description=entry.get("description", ""),
            color=entry.get("color", "#0d9488"),
            icon=entry.get("icon", "folder"),
            tags=tuple(entry.get("tags", [])),
            tasks=tasks,
            fields=fields,
            sprints=sprints,
            created_in_days=entry.get("created_in_days"),
        )
        validate_project(path, project)
        projects.append(project)
    return tuple(projects)


def field_spec(path: Path, entry: dict) -> FieldSpec:
    try:
        field_type = ProjectFieldType(entry.get("type", ""))
    except ValueError as exc:
        raise ProjectContentError(
            f"{path.name}: field {entry.get('name')!r} has unknown type {entry.get('type')!r}"
        ) from exc
    if not entry.get("name"):
        raise ProjectContentError(f"{path.name}: every custom field needs a 'name'")
    return FieldSpec(
        name=entry["name"],
        field_type=field_type,
        options=tuple(entry.get("options", [])),
    )


def series_template(path: Path, entry: dict) -> SeriesTemplate:
    for key in ("name", "slug", "task_count", "team", "epics", "stories", "subtasks"):
        if not entry.get(key):
            raise ProjectContentError(f"{path.name}: every project series needs '{key}'")
    task_count = entry["task_count"]
    if not isinstance(task_count, int) or not 1 <= task_count <= MAX_TASKS_PER_SERIES:
        raise ProjectContentError(
            f"{path.name}: task_count must be between 1 and {MAX_TASKS_PER_SERIES}"
        )
    start, end = entry.get("start_in_days", -90), entry.get("end_in_days", 60)
    sprint_days = entry.get("sprint_days", 14)
    if end - start < sprint_days * 2:
        raise ProjectContentError(f"{path.name}: {entry['slug']} window is shorter than 2 sprints")

    fields = tuple(field_spec(path, item) for item in entry.get("fields", []))
    return SeriesTemplate(
        name=entry["name"],
        slug=entry["slug"],
        description=entry.get("description", ""),
        color=entry.get("color", "#0d9488"),
        icon=entry.get("icon", "folder"),
        tags=tuple(entry.get("tags", [])),
        task_count=task_count,
        start_in_days=start,
        end_in_days=end,
        sprint_days=sprint_days,
        sprint_goals=tuple(entry.get("sprint_goals", [])) or ("Ship the committed scope",),
        team=tuple(entry["team"]),
        task_tags=tuple(entry.get("task_tags", [])),
        fields=fields,
        field_samples={
            item["name"]: tuple(item["values"])
            for item in entry.get("fields", [])
            if item.get("values")
        },
        epics=tuple(entry["epics"]),
        stories=tuple(entry["stories"]),
        bugs=tuple(entry.get("bugs", [])),
        subtasks=tuple(entry["subtasks"]),
        descriptions=tuple(entry.get("descriptions", [])),
        acceptance=tuple(entry.get("acceptance", [])),
        variables={name: tuple(values) for name, values in entry.get("variables", {}).items()},
        milestones=tuple(entry.get("milestones", [])),
        recurring=tuple(
            RecurringSpec(title=item["title"], pattern=item.get("pattern", "weekly"))
            for item in entry.get("recurring", [])
        ),
    )


def recurrence_rule(pattern: str, days_of_week: tuple[str, ...] = ()) -> str:
    """Same JSON shape the task recurrence picker stores."""
    config: dict[str, object] = {"pattern": pattern, "interval": 1, "occurrences_created": 1}
    if days_of_week:
        config["days_of_week"] = list(days_of_week)
    return dumps_str(config)


def validate_project(path: Path, project: ProjectSpec) -> None:
    """Parents and blockers must precede their dependents, since tasks are created in order."""
    seen: set[str] = set()
    sprint_names = {sprint.name for sprint in project.sprints}
    field_names = {field.name for field in project.fields}
    for task in project.tasks:
        for ref in (task.parent, *task.blocked_by):
            if ref is not None and ref not in seen:
                raise ProjectContentError(
                    f"{path.name}: {project.slug} task {task.title!r} references {ref!r} "
                    "before it is defined"
                )
        if task.sprint is not None and task.sprint not in sprint_names:
            raise ProjectContentError(
                f"{path.name}: {project.slug} task {task.title!r} names unknown sprint "
                f"{task.sprint!r}"
            )
        for name, _ in task.field_values:
            if name not in field_names:
                raise ProjectContentError(
                    f"{path.name}: {project.slug} task {task.title!r} sets unknown field {name!r}"
                )
        if task.key is not None:
            if task.key in seen:
                raise ProjectContentError(
                    f"{path.name}: {project.slug} repeats task key {task.key!r}"
                )
            seen.add(task.key)


def _task_spec(path: Path, entry: dict) -> TaskSpec:
    if not entry.get("title"):
        raise ProjectContentError(f"{path.name}: every task needs a 'title'")
    recurrence = entry.get("recurrence")
    return TaskSpec(
        title=entry["title"],
        description=entry.get("description", ""),
        status=entry.get("status", "status_todo"),
        priority=entry.get("priority", "priority_medium"),
        task_type=entry.get("type", TaskType.TASK),
        start_in_days=entry.get("start_in_days"),
        due_in_days=entry.get("due_in_days"),
        assignees=tuple(entry.get("assignees", [])),
        key=entry.get("key"),
        parent=entry.get("parent"),
        blocked_by=tuple(entry.get("blocked_by", [])),
        is_milestone=entry.get("milestone", False),
        sprint=entry.get("sprint"),
        estimated_minutes=entry.get("estimated_minutes"),
        time_spent_minutes=entry.get("time_spent_minutes"),
        tags=tuple(entry.get("tags", [])),
        field_values=tuple(
            (name, tuple(value) if isinstance(value, list) else value)
            for name, value in entry.get("fields", {}).items()
        ),
        recurrence_rule=(
            recurrence_rule(recurrence["pattern"], tuple(recurrence.get("days_of_week", [])))
            if recurrence
            else None
        ),
        created_in_days=entry.get("created_in_days"),
        completed_in_days=entry.get("completed_in_days"),
    )
