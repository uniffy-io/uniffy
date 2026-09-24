"""Expand project_series.json templates into large, deterministic demo projects.

Status, sprint and completion follow each task's dates relative to the seeding day.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from pathlib import Path

from uniffy.core.models.projects.field_definition import DefaultTaskStatusId, ProjectFieldType
from uniffy.core.models.projects.task import TaskType
from uniffy.scripts.demo_company.project_specs import (
    FieldSpec,
    FieldValue,
    ProjectContentError,
    ProjectSpec,
    RecurringSpec,
    SeriesTemplate,
    SprintSpec,
    TaskSpec,
    recurrence_rule,
    series_template,
    validate_project,
)

PRIORITIES = ("priority_low", "priority_medium", "priority_high", "priority_urgent")
PRIORITY_WEIGHTS = (20, 45, 25, 10)
BUG_PRIORITY_WEIGHTS = (10, 30, 35, 25)
WORK_TYPES = (TaskType.STORY, TaskType.FEATURE, TaskType.TASK, TaskType.BUG)
WORK_TYPE_WEIGHTS = (45, 20, 20, 15)
ESTIMATES = {
    TaskType.STORY: (240, 480, 960, 1440, 1920),
    TaskType.FEATURE: (480, 960, 1440, 2400),
    TaskType.TASK: (60, 120, 240, 480),
    TaskType.BUG: (60, 120, 240, 480),
}
SUBTASK_ESTIMATES = (30, 60, 90, 120, 240)
STORY_DURATIONS = (2, 3, 5, 7, 10)

TODO = DefaultTaskStatusId.TODO
IN_PROGRESS = DefaultTaskStatusId.IN_PROGRESS
REVIEW = DefaultTaskStatusId.REVIEW
DONE = DefaultTaskStatusId.COMPLETED
STATUS_RANK = {TODO: 0, IN_PROGRESS: 1, REVIEW: 2, DONE: 3}


@dataclass
class _Draft:
    key: str
    title: str
    task_type: str
    start: int
    due: int
    epic: str
    parent: _Draft | None = None
    children: list[_Draft] = field(default_factory=list)
    blocked_by: list[_Draft] = field(default_factory=list)
    is_milestone: bool = False
    status: str = TODO
    priority: str = "priority_medium"
    assignees: tuple[str, ...] = ()
    sprint: SprintSpec | None = None
    estimate: int | None = None
    spent: int | None = None
    tags: tuple[str, ...] = ()
    field_values: tuple[tuple[str, FieldValue], ...] = ()
    description: str = ""
    recurrence: str | None = None
    created: int = 0
    completed: int | None = None


def load_project_series(path: Path, raw: object) -> tuple[ProjectSpec, ...]:
    if not isinstance(raw, list):
        raise ProjectContentError(f"{path.name} must hold a JSON array")
    projects = []
    for entry in raw:
        project = SeriesBuilder(series_template(path, entry)).build()
        validate_project(path, project)
        projects.append(project)
    return tuple(projects)


class SeriesBuilder:
    """Seeded by the project slug, so every run renders the same project."""

    def __init__(self, template: SeriesTemplate) -> None:
        self.template = template
        self.rng = random.Random(template.slug)
        self._next_key = 0
        self.sprints = self._sprints()
        self.project_created = template.start_in_days - 21

    def build(self) -> ProjectSpec:
        t = self.template
        epics = [self._epic(index, title) for index, title in enumerate(t.epics)]
        budget = t.task_count - len(epics) - len(t.milestones) - len(t.recurring)
        if budget < 1:
            raise ProjectContentError(
                f"{t.slug}: task_count {t.task_count} leaves no room below the epics, "
                "milestones and recurring tasks"
            )

        weights = [self.rng.uniform(0.6, 1.4) for _ in epics]
        while budget > 0:
            epic = self.rng.choices(epics, weights)[0]
            story = self._story(epic)
            budget -= 1
            for _ in range(min(self._subtask_count(story), budget)):
                story.children.append(self._subtask(story))
                budget -= 1

        for epic in epics:
            self._settle(epic)
            self._schedule(epic)
        milestones = [
            self._milestone(index, title, epics) for index, title in enumerate(t.milestones)
        ]
        recurring = [self._recurring(spec) for spec in t.recurring]

        ordered = [draft for epic in epics for draft in _depth_first(epic)]
        ordered += milestones + recurring
        return ProjectSpec(
            name=t.name,
            slug=t.slug,
            description=t.description,
            color=t.color,
            icon=t.icon,
            tags=t.tags,
            tasks=tuple(self._freeze(draft) for draft in ordered),
            fields=t.fields,
            sprints=self.sprints,
            created_in_days=self.project_created,
        )

    def _key(self) -> str:
        self._next_key += 1
        return f"{self.template.slug}-{self._next_key}"

    def _sprints(self) -> tuple[SprintSpec, ...]:
        t = self.template
        sprints: list[SprintSpec] = []
        # The last stretch of the project stays unscheduled, so the backlog has content.
        start = t.start_in_days
        while start + t.sprint_days <= t.end_in_days - t.sprint_days:
            number = len(sprints) + 1
            sprints.append(
                SprintSpec(
                    name=f"Sprint {number}",
                    goal=t.sprint_goals[(number - 1) % len(t.sprint_goals)],
                    start_in_days=start,
                    end_in_days=start + t.sprint_days - 1,
                )
            )
            start += t.sprint_days
        return tuple(sprints)

    def _epic(self, index: int, title: str) -> _Draft:
        t = self.template
        span = t.end_in_days - t.start_in_days
        offset = round(index * span * 0.7 / max(len(t.epics) - 1, 1))
        start = max(t.start_in_days, t.start_in_days + offset + self.rng.randint(-5, 5))
        length = self.rng.randint(28, max(35, span // 2))
        due = min(start + length, t.end_in_days)
        epic = _Draft(
            key=self._key(),
            title=title,
            task_type=TaskType.EPIC,
            start=start,
            due=due,
            epic=title,
            assignees=(self.rng.choice(t.team),),
            priority=self._priority(TaskType.EPIC),
            tags=tuple(self.rng.sample(t.task_tags, 1)) if t.task_tags else (),
        )
        return epic

    def _story(self, epic: _Draft) -> _Draft:
        task_type = self.rng.choices(WORK_TYPES, WORK_TYPE_WEIGHTS)[0]
        templates = (
            self.template.bugs
            if task_type == TaskType.BUG and self.template.bugs
            else self.template.stories
        )
        start = self.rng.randint(epic.start, max(epic.start, epic.due - 3))
        due = min(start + self.rng.choice(STORY_DURATIONS), epic.due)
        story = _Draft(
            key=self._key(),
            title=self._render(self.rng.choice(templates), epic.title),
            task_type=task_type,
            start=start,
            due=due,
            epic=epic.title,
            parent=epic,
            priority=self._priority(task_type),
            assignees=self._assignees(),
            estimate=self.rng.choice(ESTIMATES[task_type]),
            tags=self._tags(),
        )
        siblings = epic.children
        if siblings and self.rng.random() < 0.2:
            story.blocked_by.append(siblings[-1])
        epic.children.append(story)
        story.field_values = self._field_values(story)
        return story

    def _subtask_count(self, story: _Draft) -> int:
        if story.task_type == TaskType.BUG:
            return 0 if self.rng.random() < 0.7 else 2
        return 0 if self.rng.random() < 0.45 else self.rng.randint(1, 4)

    def _subtask(self, story: _Draft) -> _Draft:
        start = self.rng.randint(story.start, story.due)
        assignees = story.assignees[:1] if self.rng.random() < 0.7 else self._assignees()
        subtask = _Draft(
            key=self._key(),
            title=self._render(self.rng.choice(self.template.subtasks), story.epic),
            task_type=TaskType.TASK,
            start=start,
            due=self.rng.randint(start, story.due),
            epic=story.epic,
            parent=story,
            priority=story.priority,
            assignees=assignees,
            estimate=self.rng.choice(SUBTASK_ESTIMATES),
            tags=story.tags if self.rng.random() < 0.5 else (),
        )
        subtask.field_values = self._field_values(subtask)
        return subtask

    def _milestone(self, index: int, title: str, epics: list[_Draft]) -> _Draft:
        t = self.template
        fraction = (index + 1) / (len(t.milestones) + 1)
        due = t.start_in_days + round((t.end_in_days - t.start_in_days) * fraction)
        stories = sorted(
            (story for epic in epics for story in epic.children if story.due <= due),
            key=lambda story: story.due,
        )
        blockers = stories[-3:]
        milestone = _Draft(
            key=self._key(),
            title=title,
            task_type=TaskType.TASK,
            start=due,
            due=due,
            epic=title,
            blocked_by=blockers,
            is_milestone=True,
            priority="priority_high",
            assignees=(t.team[0],),
        )
        if due < 0 and all(blocker.status == DONE for blocker in blockers):
            milestone.status = DONE
            milestone.completed = due
        elif due < 0:
            milestone.status = IN_PROGRESS
        milestone.created = self.project_created + 1
        milestone.description = self._description(milestone)
        return milestone

    def _recurring(self, spec: RecurringSpec) -> _Draft:
        due = self.rng.randint(0, 6)
        draft = _Draft(
            key=self._key(),
            title=spec.title,
            task_type=TaskType.TASK,
            start=due,
            due=due,
            epic=spec.title,
            priority="priority_medium",
            assignees=(self.rng.choice(self.template.team),),
            estimate=60,
            recurrence=recurrence_rule(spec.pattern),
        )
        draft.created = self.project_created + 2
        draft.description = self._description(draft)
        return draft

    def _settle(self, draft: _Draft) -> None:
        """Leaves take a status from their dates; parents roll up from their children."""
        for child in draft.children:
            self._settle(child)

        if draft.children:
            draft.start = min(child.start for child in draft.children)
            draft.due = max(child.due for child in draft.children)
            draft.status = _rolled_up_status([child.status for child in draft.children])
            if draft.status == DONE:
                draft.completed = max(child.completed or 0 for child in draft.children)
            draft.created = max(
                self.project_created + 1,
                min(child.created for child in draft.children) - self.rng.randint(0, 3),
            )
        else:
            draft.status = self._leaf_status(draft)
            if draft.status == DONE:
                draft.completed = max(draft.start, min(draft.due + self.rng.randint(-1, 2), 0))
            draft.created = max(
                self.project_created + 1, min(draft.start - self.rng.randint(1, 14), 0)
            )
        draft.spent = self._time_spent(draft)
        draft.description = self._description(draft)

    def _schedule(self, draft: _Draft) -> None:
        """Top-down, so subtasks land in the sprint their parent story was planned into."""
        if draft.parent is not None and draft.parent.task_type != TaskType.EPIC:
            draft.sprint = draft.parent.sprint
        elif draft.task_type != TaskType.EPIC:
            draft.sprint = self._sprint_for(draft)
        for child in draft.children:
            self._schedule(child)

    def _leaf_status(self, draft: _Draft) -> str:
        if draft.due < 0:
            choices, weights = (DONE, REVIEW, IN_PROGRESS, TODO), (88, 4, 5, 3)
        elif draft.start <= 0:
            choices, weights = (IN_PROGRESS, REVIEW, TODO, DONE), (45, 20, 25, 10)
        else:
            choices, weights = (TODO, IN_PROGRESS), (95, 5)
        return self.rng.choices(choices, weights)[0]

    def _sprint_for(self, draft: _Draft) -> SprintSpec | None:
        if draft.status == TODO and draft.due > 0 and self.rng.random() < 0.35:
            return None
        for sprint in self.sprints:
            if sprint.start_in_days <= draft.due <= sprint.end_in_days:
                return sprint
        return None

    def _time_spent(self, draft: _Draft) -> int | None:
        if draft.estimate is None or draft.status == TODO:
            return None
        low, high = (0.6, 1.5) if draft.status == DONE else (0.2, 0.8)
        return max(15, round(draft.estimate * self.rng.uniform(low, high) / 15) * 15)

    def _priority(self, task_type: str) -> str:
        weights = BUG_PRIORITY_WEIGHTS if task_type == TaskType.BUG else PRIORITY_WEIGHTS
        return self.rng.choices(PRIORITIES, weights)[0]

    def _assignees(self) -> tuple[str, ...]:
        roll = self.rng.random()
        if roll < 0.12:
            return ()
        if roll < 0.2:
            return tuple(self.rng.sample(self.template.team, min(2, len(self.template.team))))
        return (self.rng.choice(self.template.team),)

    def _tags(self) -> tuple[str, ...]:
        if not self.template.task_tags:
            return ()
        count = self.rng.choices((0, 1, 2), (35, 45, 20))[0]
        return tuple(
            self.rng.sample(self.template.task_tags, min(count, len(self.template.task_tags)))
        )

    def _field_values(self, draft: _Draft) -> tuple[tuple[str, FieldValue], ...]:
        values: list[tuple[str, FieldValue]] = []
        is_subtask = draft.parent is not None and draft.parent.task_type != TaskType.EPIC
        for spec in self.template.fields:
            value = self._field_value(spec, draft, is_subtask)
            if value is not None:
                values.append((spec.name, value))
        return tuple(values)

    def _field_value(self, spec: FieldSpec, draft: _Draft, is_subtask: bool) -> FieldValue | None:
        rng = self.rng
        samples = self.template.field_samples.get(spec.name, ())
        kind = spec.field_type
        if kind == ProjectFieldType.NUMBER and samples:
            return rng.choice(samples) if not is_subtask and rng.random() < 0.85 else None
        if kind == ProjectFieldType.TEXT and samples:
            return str(rng.choice(samples)) if rng.random() < 0.25 else None
        if kind == ProjectFieldType.SINGLE_SELECT and spec.options:
            return rng.choice(spec.options) if rng.random() < 0.85 else None
        if kind == ProjectFieldType.MULTI_SELECT and spec.options:
            if rng.random() >= 0.6:
                return None
            return tuple(rng.sample(spec.options, rng.randint(1, min(2, len(spec.options)))))
        if kind == ProjectFieldType.PERSON:
            return rng.choice(self.template.team) if not is_subtask and rng.random() < 0.5 else None
        if kind == ProjectFieldType.DATE:
            return draft.due + rng.randint(7, 30) if rng.random() < 0.3 else None
        return None

    def _render(self, template: str, epic: str) -> str:
        text = template.replace("{epic}", epic)
        for name, options in self.template.variables.items():
            token = "{" + name + "}"
            if token in text:
                text = text.replace(token, self.rng.choice(options))
        return text

    def _description(self, draft: _Draft) -> str:
        if not self.template.descriptions:
            return ""
        body = self._render(self.rng.choice(self.template.descriptions), draft.epic)
        if not self.template.acceptance or draft.task_type == TaskType.EPIC or draft.recurrence:
            return body
        box = "[x]" if draft.status == DONE else "[ ]"
        picks = self.rng.sample(self.template.acceptance, min(3, len(self.template.acceptance)))
        criteria = "\n".join(f"- {box} {self._render(item, draft.epic)}" for item in picks)
        return f"{body}\n\n## Acceptance criteria\n\n{criteria}"

    def _freeze(self, draft: _Draft) -> TaskSpec:
        return TaskSpec(
            title=draft.title,
            description=draft.description,
            status=draft.status,
            priority=draft.priority,
            task_type=draft.task_type,
            start_in_days=None if draft.recurrence else draft.start,
            due_in_days=draft.due,
            assignees=draft.assignees,
            key=draft.key,
            parent=draft.parent.key if draft.parent else None,
            blocked_by=tuple(blocker.key for blocker in draft.blocked_by),
            is_milestone=draft.is_milestone,
            sprint=draft.sprint.name if draft.sprint else None,
            estimated_minutes=draft.estimate,
            time_spent_minutes=draft.spent,
            tags=draft.tags,
            field_values=draft.field_values,
            recurrence_rule=draft.recurrence,
            created_in_days=draft.created,
            completed_in_days=draft.completed,
        )


def _depth_first(draft: _Draft) -> list[_Draft]:
    return [draft, *(item for child in draft.children for item in _depth_first(child))]


def _rolled_up_status(statuses: list[str]) -> str:
    if all(status == DONE for status in statuses):
        return DONE
    if all(status == TODO for status in statuses):
        return TODO
    if min(STATUS_RANK[status] for status in statuses) >= STATUS_RANK[REVIEW]:
        return REVIEW
    return IN_PROGRESS
