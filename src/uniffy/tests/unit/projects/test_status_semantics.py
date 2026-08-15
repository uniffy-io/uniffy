import pytest

from uniffy.core.errors import ValidationError
from uniffy.core.models.projects.field_definition import TaskStatusSemantic
from uniffy.domains.projects.statuses import parse_task_status_semantics


def test_status_semantics_use_configured_ids() -> None:
    semantics = parse_task_status_semantics(
        {
            "options": [
                {"id": "queue", "semantic": "todo"},
                {"id": "doing", "semantic": "in_progress"},
                {"id": "shipped", "semantic": "completed"},
            ]
        },
        require_explicit=True,
    )

    assert semantics.id_for(TaskStatusSemantic.TODO) == "queue"
    assert semantics.id_for(TaskStatusSemantic.IN_PROGRESS) == "doing"
    assert semantics.is_completed("shipped")
    assert not semantics.is_completed("doing")


def test_status_semantics_support_unmigrated_canonical_ids() -> None:
    semantics = parse_task_status_semantics({
        "options": [
            {"id": "status_todo"},
            {"id": "status_in_progress"},
            {"id": "status_done"},
        ]
    })

    assert semantics.is_completed("status_done")


@pytest.mark.parametrize(
    "options",
    [
        [
            {"id": "queue", "semantic": "todo"},
            {"id": "doing", "semantic": "in_progress"},
        ],
        [
            {"id": "queue", "semantic": "todo"},
            {"id": "doing", "semantic": "in_progress"},
            {"id": "shipped", "semantic": "completed"},
            {"id": "closed", "semantic": "completed"},
        ],
    ],
)
def test_status_semantics_reject_missing_or_duplicate_required_roles(options: list[dict]) -> None:
    with pytest.raises(ValidationError):
        parse_task_status_semantics({"options": options}, require_explicit=True)
