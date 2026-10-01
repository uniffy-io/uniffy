"""What an export asks for and what a checked export will read."""

from dataclasses import dataclass, field
from enum import StrEnum
from uuid import UUID

from sqlalchemy import Select
from uniffy_proto.projects.v1.projects_pb import TaskFilterGroup, TaskSort

from uniffy.core.models.projects.project import Project


class ExportLayout(StrEnum):
    FLAT = "flat"
    OUTLINE = "outline"


class ExportScope(StrEnum):
    VIEW = "view"
    PROJECT = "project"


@dataclass(frozen=True)
class ExportRequest:
    organization_id: UUID
    project_ids: tuple[UUID, ...]
    task_filter: TaskFilterGroup | None = None
    sort: tuple[TaskSort, ...] = ()
    view_id: str | None = None
    layout: ExportLayout = ExportLayout.FLAT
    include_bundle: bool = False
    time_zone: str | None = None

    @property
    def narrowed(self) -> bool:
        has_filter = self.task_filter is not None and len(self.task_filter.nodes) > 0
        return has_filter or bool(self.sort) or self.view_id is not None

    @property
    def scope(self) -> ExportScope:
        if self.narrowed or self.layout is ExportLayout.OUTLINE:
            return ExportScope.VIEW
        return ExportScope.PROJECT


@dataclass
class ExportPlan:
    """A checked export: viewable projects in output order and each one's ordered task query.

    Under the OUTLINE layout a project's query selects its root tasks only.
    """

    user_id: UUID
    request: ExportRequest
    projects: list[Project]
    queries: dict[UUID, Select] = field(default_factory=dict)
    row_counts: dict[UUID, int] = field(default_factory=dict)

    @property
    def row_count(self) -> int:
        return sum(self.row_counts.values())
