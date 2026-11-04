"""The task pinned fields appearance key: defaults, validation, proto round trip."""

import pytest
from uniffy_proto.settings.v1.settings_pb import AppearanceSettings, TaskPinnedFields

from uniffy.core.errors import ValidationError
from uniffy.domains.settings.converters import (
    appearance_dict_to_proto,
    appearance_from_proto,
)
from uniffy.domains.settings.defaults import MAX_TASK_PINNED_FIELDS, get_effective_appearance
from uniffy.domains.settings.operations import _validate_appearance


def test_default_pins_status_priority_assignees_and_due_date() -> None:
    effective = get_effective_appearance(None)
    assert effective["task_pinned_fields"] == ["status", "priority", "assignees", "due_date"]


def test_override_replaces_the_default_list() -> None:
    effective = get_effective_appearance({"task_pinned_fields": ["tags", "status"]})
    assert effective["task_pinned_fields"] == ["tags", "status"]


def test_pinning_nothing_is_kept() -> None:
    assert get_effective_appearance({"task_pinned_fields": []})["task_pinned_fields"] == []


def test_validate_accepts_known_fields_and_empty() -> None:
    _validate_appearance({"task_pinned_fields": ["status", "sprint", "estimate"]})
    _validate_appearance({"task_pinned_fields": []})
    _validate_appearance({"task_pinned_fields": None})


@pytest.mark.parametrize(
    "pinned",
    [
        ["status", "story_points"],
        ["status", "status"],
        ["status", "priority", "assignees", "due_date", "start_date", "tags", "type"],
        "status",
    ],
)
def test_validate_rejects_bad_lists(pinned: object) -> None:
    with pytest.raises(ValidationError):
        _validate_appearance({"task_pinned_fields": pinned})


def test_limit_matches_the_default_ceiling() -> None:
    assert MAX_TASK_PINNED_FIELDS == 6


def test_proto_round_trip_keeps_order() -> None:
    proto = appearance_dict_to_proto({"task_pinned_fields": ["due_date", "status"]})
    assert list(proto.task_pinned_fields.field_ids) == ["due_date", "status"]
    assert appearance_from_proto(proto) == {"task_pinned_fields": ["due_date", "status"]}


def test_empty_list_survives_the_wire() -> None:
    proto = appearance_dict_to_proto({"task_pinned_fields": []})
    assert proto.has_field("task_pinned_fields")
    assert appearance_from_proto(proto) == {"task_pinned_fields": []}


def test_unset_wrapper_leaves_the_preference_alone() -> None:
    assert appearance_from_proto(AppearanceSettings(theme="dark")) == {"theme": "dark"}
    explicit = AppearanceSettings(task_pinned_fields=TaskPinnedFields(field_ids=["tags"]))
    assert appearance_from_proto(explicit) == {"task_pinned_fields": ["tags"]}
