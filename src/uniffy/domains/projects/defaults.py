"""Default project fields and views."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.projects.field_definition import (
    DefaultTaskStatusId,
    FieldDefinition,
    ProjectFieldType,
    SystemProjectFieldId,
    TaskStatusSemantic,
)
from uniffy.core.models.projects.view_config import ViewConfig


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
                        "color": "#6b7280",
                        "sortOrder": 0,
                    },
                    {
                        "id": DefaultTaskStatusId.IN_PROGRESS,
                        "semantic": TaskStatusSemantic.IN_PROGRESS,
                        "label": "In Progress",
                        "color": "#3b82f6",
                        "sortOrder": 1,
                    },
                    {
                        "id": DefaultTaskStatusId.REVIEW,
                        "semantic": TaskStatusSemantic.REVIEW,
                        "label": "Review",
                        "color": "#f59e0b",
                        "sortOrder": 2,
                    },
                    {
                        "id": DefaultTaskStatusId.COMPLETED,
                        "semantic": TaskStatusSemantic.COMPLETED,
                        "label": "Done",
                        "color": "#22c55e",
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


async def stage_default_project_views(session: AsyncSession, project_id: UUID) -> str:
    """Create the default views (table, board, roadmap) for a project."""
    default_views = [
        ViewConfig(
            id="view_table",
            project_id=project_id,
            name="Table",
            type="table",
            is_default=True,
            config={
                "type": "table",
                "visibleFieldIds": [
                    "field_title",
                    "field_status",
                    "field_priority",
                    "field_assignee",
                    "field_due_date",
                ],
                "columnWidths": {},
                "sortFieldId": None,
                "sortDirection": "asc",
                "groupByFieldId": None,
            },
        ),
        ViewConfig(
            id="view_board",
            project_id=project_id,
            name="Board",
            type="board",
            is_default=False,
            config={
                "type": "board",
                "statusFieldId": "field_status",
                "visibleFieldIds": ["field_priority", "field_assignee", "field_due_date"],
                "collapsedColumnIds": [],
            },
        ),
        ViewConfig(
            id="view_roadmap",
            project_id=project_id,
            name="Roadmap",
            type="roadmap",
            is_default=False,
            config={
                "type": "roadmap",
                "startDateFieldId": "field_start_date",
                "endDateFieldId": "field_due_date",
                "zoomLevel": "week",
                "visibleFieldIds": ["field_status", "field_priority"],
            },
        ),
    ]

    for view in default_views:
        session.add(view)

    await session.flush()

    return "view_table"
