import pytest
from uniffy_proto.projects.v1.projects_pb import TaskBlockerIds, UpdateTaskRequest

from uniffy.domains.projects.tasks.requests import update_task_arguments


@pytest.mark.parametrize("base", [None, "", " original \n"])
def test_description_base_preserves_presence_and_exact_text(base: str | None) -> None:
    request = UpdateTaskRequest(description="edited")
    if base is not None:
        request.base_description = base
    updates = update_task_arguments(request)
    assert updates["description"] == request.description
    assert ("base_description" in updates) == (base is not None)
    if base is not None:
        assert updates["base_description"] == base


def test_metadata_request_omits_description_and_base() -> None:
    request = UpdateTaskRequest(title="Renamed")
    assert update_task_arguments(request) == {"title": request.title}


def test_empty_blocker_set_removes_every_blocker() -> None:
    request = UpdateTaskRequest(blocked_by=TaskBlockerIds(ids=[]))
    assert update_task_arguments(request) == {"blocked_by_task_ids": []}


def test_blocker_set_replaces_blockers() -> None:
    request = UpdateTaskRequest(blocked_by=TaskBlockerIds(ids=["a", "b"]))
    assert update_task_arguments(request) == {"blocked_by_task_ids": ["a", "b"]}


def test_unset_blocker_set_leaves_blockers_untouched() -> None:
    assert "blocked_by_task_ids" not in update_task_arguments(UpdateTaskRequest(title="x"))


def test_legacy_blocker_list_still_applies_when_the_set_is_absent() -> None:
    request = UpdateTaskRequest(blocked_by_task_ids=["a"])
    assert update_task_arguments(request) == {"blocked_by_task_ids": ["a"]}


def test_blocker_set_wins_over_the_legacy_list() -> None:
    request = UpdateTaskRequest(blocked_by=TaskBlockerIds(ids=[]), blocked_by_task_ids=["a"])
    assert update_task_arguments(request) == {"blocked_by_task_ids": []}
