"""The view filter and sort cases the web evaluator and the server's SQL are both held to."""

from datetime import date, datetime, time
from pathlib import Path
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from google.protobuf import json_format
from uniffy_proto.projects.v1.projects_pb2 import TaskFilterGroup, TaskSort

from uniffy.core.json_codec import loads
from uniffy.core.models.projects.field_definition import FieldDefinition, ProjectFieldType
from uniffy.core.types import generate_id

CASE_FILE = (
    Path(__file__).resolve().parents[2]
    / "proto"
    / "projects"
    / "v1"
    / "testdata"
    / "view_filter_cases.json"
)

CASES: dict[str, Any] = loads(CASE_FILE.read_bytes())
CONTEXT: dict[str, str] = CASES["context"]


def symbols() -> dict[str, UUID]:
    """A fresh row id for every symbolic task, user, sprint and tag id in the file."""
    names = [task["id"] for task in CASES["tasks"]]
    names += [user["id"] for user in CASES["users"]]
    names += [sprint["id"] for sprint in CASES["sprints"]]
    names += list(CASES["tags"])
    return {name: generate_id() for name in names}


def _bind(value: Any, ids: dict[str, UUID]) -> Any:
    if isinstance(value, dict):
        return {
            key: (
                [str(ids.get(item, item)) for item in inner]
                if key == "ids" and isinstance(inner, list)  # noqa: PLR2004 - case file key
                else _bind(inner, ids)
            )
            for key, inner in value.items()
        }
    if isinstance(value, list):
        return [_bind(item, ids) for item in value]
    return value


def task_filter(case: dict[str, Any], ids: dict[str, UUID]) -> TaskFilterGroup:
    return json_format.ParseDict(_bind(case["filter"], ids), TaskFilterGroup())


def sort_keys(case: dict[str, Any], ids: dict[str, UUID]) -> list[TaskSort]:
    return [json_format.ParseDict(_bind(key, ids), TaskSort()) for key in case["sort"]]


def field_definitions(project_id: UUID) -> list[FieldDefinition]:
    return [
        FieldDefinition(
            id=field["id"],
            project_id=project_id,
            name=field["id"],
            type=ProjectFieldType(field["type"]),
            is_system=field["id"].startswith("field_"),
            sort_order=index,
            config=(
                {
                    "options": [
                        {"id": option, "label": option, "sortOrder": order}
                        for order, option in enumerate(field["options"])
                    ]
                }
                if "options" in field  # noqa: PLR2004 - case file key
                else {}
            ),
        )
        for index, field in enumerate(CASES["fields"])
    ]


def noon_of_today(zone_name: str) -> datetime:
    """An instant whose calendar day in ``zone_name`` is the file's today."""
    today = date.fromisoformat(CONTEXT["today"])
    return datetime.combine(today, time(12), tzinfo=ZoneInfo(zone_name))
