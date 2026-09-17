import pytest

from uniffy.core.errors import ValidationError
from uniffy.core.models.projects.field_definition import TaskStatusSemantic
from uniffy.domains.projects.statuses import (
    parse_task_status_semantics,
    removed_status_labels,
)


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


def test_removed_status_labels_lists_only_dropped_options() -> None:
    previous = {
        "options": [
            {"id": "queue", "label": "Queue", "semantic": "todo"},
            {"id": "blocked", "label": "Blocked"},
            {"id": "parked"},
        ]
    }
    updated = {"options": [{"id": "queue", "label": "Backlog", "semantic": "todo"}]}

    assert removed_status_labels(previous, updated) == {"blocked": "Blocked", "parked": "parked"}
    assert removed_status_labels(previous, previous) == {}
    assert removed_status_labels(None, updated) == {}
