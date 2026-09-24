"""Default project fields and views."""

from uuid import UUID

from protobuf import Oneof
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.projects.v1.projects_pb import (
    BacklogLayout,
    BoardLayout,
    GraphLayout,
    ResourcesLayout,
    RoadmapLayout,
    RoadmapZoom,
    TableLayout,
    TaskFieldRef,
    ViewDefinition,
)

from uniffy.core.models.projects.field_definition import (
    DefaultTaskStatusId,
    FieldDefinition,
    ProjectFieldType,
    SystemProjectFieldId,
    TaskStatusSemantic,
)
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.view_config import (
    DefaultProjectViewId,
    ProjectViewVisibility,
    ViewConfig,
)
from uniffy.domains.projects.status_colors import brand_ramp_color
from uniffy.domains.projects.views.definition import definition_to_dict, view_type_for


async def stage_default_project_fields(session: AsyncSession, project_id: UUID) -> None:
    default_fields = [
        FieldDefinition(
            id=SystemProjectFieldId.TITLE,
            project_id=project_id,
            name="Title",
            type=ProjectFieldType.TEXT,
            is_required=True,
            is_system=True,
            sort_order=0,
            config={},
        ),
        FieldDefinition(
            id=SystemProjectFieldId.STATUS,
            project_id=project_id,
            name="Status",
            type=ProjectFieldType.SINGLE_SELECT,
            is_required=False,
            is_system=True,
            sort_order=1,
            config={
                "options": [
                    {
                        "id": DefaultTaskStatusId.TODO,
                        "semantic": TaskStatusSemantic.TODO,
                        "label": "To Do",
                        "color": brand_ramp_color(0, 4),
                        "sortOrder": 0,
                    },
                    {
                        "id": DefaultTaskStatusId.IN_PROGRESS,
                        "semantic": TaskStatusSemantic.IN_PROGRESS,
                        "label": "In Progress",
                        "color": brand_ramp_color(1, 4),
                        "sortOrder": 1,
                    },
                    {
                        "id": DefaultTaskStatusId.REVIEW,
                        "semantic": TaskStatusSemantic.REVIEW,
                        "label": "Review",
                        "color": brand_ramp_color(2, 4),
                        "sortOrder": 2,
                    },
                    {
                        "id": DefaultTaskStatusId.COMPLETED,
                        "semantic": TaskStatusSemantic.COMPLETED,
                        "label": "Done",
                        "color": brand_ramp_color(3, 4),
                        "sortOrder": 3,
                    },
                ]
            },
        ),
        FieldDefinition(
            id=SystemProjectFieldId.PRIORITY,
            project_id=project_id,
            name="Priority",
            type=ProjectFieldType.SINGLE_SELECT,
            is_required=False,
            is_system=True,
            sort_order=2,
            config={
                "options": [
                    {
                        "id": "priority_low",
                        "label": "Low",
                        "color": "#22c55e",
                        "sortOrder": 0,
                    },
                    {
                        "id": "priority_medium",
                        "label": "Medium",
                        "color": "#f59e0b",
                        "sortOrder": 1,
                    },
                    {
                        "id": "priority_high",
                        "label": "High",
                        "color": "#ef4444",
                        "sortOrder": 2,
                    },
                    {
                        "id": "priority_urgent",
                        "label": "Urgent",
                        "color": "#dc2626",
                        "sortOrder": 3,
                    },
                ]
            },
        ),
        FieldDefinition(
            id="field_assignee",
            project_id=project_id,
            name="Assignee",
            type="person",
            is_required=False,
            is_system=True,
            sort_order=3,
            config={"allowMultiple": True},
        ),
        FieldDefinition(
            id="field_start_date",
            project_id=project_id,
            name="Start Date",
            type="date",
            is_required=False,
            is_system=True,
            sort_order=4,
            config={},
        ),
        FieldDefinition(
            id="field_due_date",
            project_id=project_id,
            name="Due Date",
            type="date",
            is_required=False,
            is_system=True,
            sort_order=5,
            config={},
        ),
    ]

    for field in default_fields:
        session.add(field)

    await session.flush()


def default_view_definitions() -> list[tuple[DefaultProjectViewId, str, ViewDefinition]]:
    """Shared views every project starts with, in tab order."""

    def fields(*field_ids: str) -> list[TaskFieldRef]:
        return [TaskFieldRef(ref=Oneof(field="field_id", value=field_id)) for field_id in field_ids]

    return [
        (
            DefaultProjectViewId.TABLE,
            "Table",
            ViewDefinition(
                layout=Oneof(field="table", value=TableLayout()),
                visible_fields=fields(
                    SystemProjectFieldId.TITLE,
                    SystemProjectFieldId.STATUS,
                    SystemProjectFieldId.PRIORITY,
                    SystemProjectFieldId.ASSIGNEE,
                    SystemProjectFieldId.DUE_DATE,
                ),
            ),
        ),
        (
            DefaultProjectViewId.BOARD,
            "Board",
            ViewDefinition(
                layout=Oneof(field="board", value=BoardLayout()),
                visible_fields=fields(
                    SystemProjectFieldId.PRIORITY,
                    SystemProjectFieldId.ASSIGNEE,
                    SystemProjectFieldId.DUE_DATE,
                ),
            ),
        ),
        (
            DefaultProjectViewId.ROADMAP,
            "Roadmap",
            ViewDefinition(
                layout=Oneof(field="roadmap", value=RoadmapLayout(zoom=RoadmapZoom.WEEK)),
                visible_fields=fields(SystemProjectFieldId.STATUS, SystemProjectFieldId.PRIORITY),
            ),
        ),
        (
            DefaultProjectViewId.BACKLOG,
            "Backlog",
            ViewDefinition(layout=Oneof(field="backlog", value=BacklogLayout())),
        ),
        (
            DefaultProjectViewId.GRAPH,
            "Graph",
            ViewDefinition(layout=Oneof(field="graph", value=GraphLayout())),
        ),
        (
            DefaultProjectViewId.RESOURCES,
            "Resources",
            ViewDefinition(layout=Oneof(field="resources", value=ResourcesLayout())),
        ),
    ]


async def stage_default_project_views(session: AsyncSession, project: Project) -> str:
    for sort_order, (view_id, name, definition) in enumerate(default_view_definitions()):
        session.add(
            ViewConfig(
                id=view_id,
                project_id=project.id,
                organization_id=project.organization_id,
                owner_id=project.owner_id,
                name=name,
                type=view_type_for(definition),
                visibility=ProjectViewVisibility.SHARED,
                sort_order=sort_order,
                definition=definition_to_dict(definition),
            )
        )

    await session.flush()

    return DefaultProjectViewId.TABLE
