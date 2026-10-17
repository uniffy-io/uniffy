import pytest
from uniffy_proto.projects.v1.projects_pb import UpdateTaskRequest

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
