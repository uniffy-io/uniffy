"""Who may create, change, delete and reorder personal and shared project views."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from connectrpc.code import Code
from uniffy_proto.projects.v1.projects_pb2 import BoardLayout, TableLayout, ViewDefinition

from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.events.realtime import ContentAccessAction
from uniffy.core.models.projects.view_config import (
    ProjectViewType,
    ProjectViewVisibility,
    ViewConfig,
)
from uniffy.core.types import ContentRole
from uniffy.domains.projects import queries
from uniffy.domains.projects.projects import ProjectOperations
from uniffy.domains.projects.rpc import map_domain_error
from uniffy.domains.projects.views import operations as view_operations
from uniffy.domains.projects.views.operations import ProjectViewOperations

SHARED = ProjectViewVisibility.SHARED
PERSONAL = ProjectViewVisibility.PERSONAL
TABLE = ViewDefinition(table=TableLayout())


class Harness(SimpleNamespace):
    session: MagicMock
    project: SimpleNamespace
    publish: AsyncMock
    user_id: object
    other_id: object


@pytest.fixture
def harness(monkeypatch: pytest.MonkeyPatch) -> Harness:
    user_id, other_id = uuid4(), uuid4()
    project = SimpleNamespace(
        id=uuid4(), organization_id=uuid4(), owner_id=other_id, default_view_id="view_table"
    )
    session = MagicMock()
    session.execute = AsyncMock(return_value=MagicMock(scalar=MagicMock(return_value=None)))
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    session.delete = AsyncMock()

    monkeypatch.setattr(ProjectOperations, "get_by_id", AsyncMock(return_value=project))
    monkeypatch.setattr(queries, "get_fields_for_project", AsyncMock(return_value=[]))
    monkeypatch.setattr(queries, "get_views_for_project", AsyncMock(return_value=[]))
    monkeypatch.setattr(view_operations, "resolve_project_audience", AsyncMock(return_value=None))
    publish = AsyncMock()
    monkeypatch.setattr(view_operations, "publish_content_access_changed", publish)

    return Harness(
        session=session, project=project, publish=publish, user_id=user_id, other_id=other_id
    )


def as_role(monkeypatch: pytest.MonkeyPatch, role: ContentRole | None) -> None:
    monkeypatch.setattr(ProjectOperations, "_resolve_role", AsyncMock(return_value=role))


def stored_view(
    monkeypatch: pytest.MonkeyPatch,
    harness: Harness,
    *,
    visibility: ProjectViewVisibility,
    owner_id,
    view_id: str = "view_abc",
    view_type: ProjectViewType = ProjectViewType.TABLE,
) -> ViewConfig:
    view = ViewConfig(
        id=view_id,
        project_id=harness.project.id,
        organization_id=harness.project.organization_id,
        owner_id=owner_id,
        name="Mine",
        type=view_type,
        visibility=visibility,
        sort_order=0,
        definition={"table": {}},
    )
    monkeypatch.setattr(queries, "get_view", AsyncMock(return_value=view))
    return view


async def create(harness: Harness, visibility: ProjectViewVisibility) -> ViewConfig:
    return await ProjectViewOperations(harness.session).create(
        harness.user_id,
        harness.project.organization_id,
        harness.project.id,
        name="My bugs",
        definition=TABLE,
        visibility=visibility,
    )


async def test_viewer_creates_a_personal_view_without_publishing(monkeypatch, harness) -> None:
    as_role(monkeypatch, ContentRole.VIEWER)

    view = await create(harness, PERSONAL)

    assert view.owner_id == harness.user_id
    assert view.visibility == PERSONAL
    assert view.type == ProjectViewType.TABLE
    assert view.definition == {"table": {}}
    assert view.id.startswith("view_")
    harness.session.commit.assert_awaited_once()
    harness.publish.assert_not_awaited()


@pytest.mark.parametrize("role", [ContentRole.VIEWER, ContentRole.COMMENTER, None])
async def test_below_editor_cannot_create_a_shared_view(monkeypatch, harness, role) -> None:
    as_role(monkeypatch, role)

    with pytest.raises(PermissionDeniedError):
        await create(harness, SHARED)
    harness.session.commit.assert_not_awaited()


async def test_editor_creates_a_shared_view_and_publishes_once(monkeypatch, harness) -> None:
    as_role(monkeypatch, ContentRole.EDITOR)

    await create(harness, SHARED)

    harness.publish.assert_awaited_once()
    assert harness.publish.await_args.kwargs["action"] == ContentAccessAction.VIEWS_CHANGED
    assert harness.publish.await_args.kwargs["content_id"] == harness.project.id


async def test_new_views_queue_after_their_scope(monkeypatch, harness) -> None:
    as_role(monkeypatch, ContentRole.VIEWER)
    harness.session.execute = AsyncMock(return_value=MagicMock(scalar=MagicMock(return_value=4)))

    view = await create(harness, PERSONAL)

    assert view.sort_order == 5


async def test_invalid_definition_is_rejected_before_commit(monkeypatch, harness) -> None:
    as_role(monkeypatch, ContentRole.EDITOR)

    with pytest.raises(ValidationError):
        await ProjectViewOperations(harness.session).create(
            harness.user_id,
            harness.project.organization_id,
            harness.project.id,
            name="Nothing",
            definition=ViewDefinition(),
            visibility=SHARED,
        )
    harness.session.commit.assert_not_awaited()


@pytest.mark.parametrize("role", [ContentRole.EDITOR, ContentRole.ADMIN, ContentRole.OWNER])
async def test_nobody_else_edits_or_deletes_a_personal_view(monkeypatch, harness, role) -> None:
    as_role(monkeypatch, role)
    stored_view(monkeypatch, harness, visibility=PERSONAL, owner_id=harness.other_id)
    ops = ProjectViewOperations(harness.session)
    org_id, project_id = harness.project.organization_id, harness.project.id

    with pytest.raises(PermissionDeniedError):
        await ops.update(harness.user_id, org_id, project_id, "view_abc", name="Stolen")
    with pytest.raises(PermissionDeniedError):
        await ops.delete(harness.user_id, org_id, project_id, "view_abc")
    harness.session.commit.assert_not_awaited()


async def test_owner_renames_own_personal_view_as_viewer(monkeypatch, harness) -> None:
    as_role(monkeypatch, ContentRole.VIEWER)
    view = stored_view(monkeypatch, harness, visibility=PERSONAL, owner_id=harness.user_id)

    await ProjectViewOperations(harness.session).update(
        harness.user_id,
        harness.project.organization_id,
        harness.project.id,
        view.id,
        name=" Renamed ",
    )

    assert view.name == "Renamed"
    harness.publish.assert_not_awaited()


async def test_viewer_cannot_edit_a_shared_view(monkeypatch, harness) -> None:
    as_role(monkeypatch, ContentRole.VIEWER)
    stored_view(monkeypatch, harness, visibility=SHARED, owner_id=harness.user_id)

    with pytest.raises(PermissionDeniedError):
        await ProjectViewOperations(harness.session).update(
            harness.user_id,
            harness.project.organization_id,
            harness.project.id,
            "view_abc",
            name="Mine now",
        )


async def test_editor_shares_own_personal_view(monkeypatch, harness) -> None:
    as_role(monkeypatch, ContentRole.EDITOR)
    view = stored_view(monkeypatch, harness, visibility=PERSONAL, owner_id=harness.user_id)

    await ProjectViewOperations(harness.session).update(
        harness.user_id,
        harness.project.organization_id,
        harness.project.id,
        view.id,
        visibility=SHARED,
    )

    assert view.visibility == SHARED
    harness.publish.assert_awaited_once()


async def test_viewer_cannot_share_own_personal_view(monkeypatch, harness) -> None:
    as_role(monkeypatch, ContentRole.VIEWER)
    stored_view(monkeypatch, harness, visibility=PERSONAL, owner_id=harness.user_id)

    with pytest.raises(PermissionDeniedError):
        await ProjectViewOperations(harness.session).update(
            harness.user_id,
            harness.project.organization_id,
            harness.project.id,
            "view_abc",
            visibility=SHARED,
        )


async def test_only_the_owner_makes_a_shared_view_personal(monkeypatch, harness) -> None:
    as_role(monkeypatch, ContentRole.ADMIN)
    stored_view(monkeypatch, harness, visibility=SHARED, owner_id=harness.other_id)

    with pytest.raises(PermissionDeniedError):
        await ProjectViewOperations(harness.session).update(
            harness.user_id,
            harness.project.organization_id,
            harness.project.id,
            "view_abc",
            visibility=PERSONAL,
        )


async def test_default_view_stays_shared(monkeypatch, harness) -> None:
    as_role(monkeypatch, ContentRole.EDITOR)
    stored_view(
        monkeypatch, harness, visibility=SHARED, owner_id=harness.user_id, view_id="view_table"
    )

    with pytest.raises(ValidationError):
        await ProjectViewOperations(harness.session).update(
            harness.user_id,
            harness.project.organization_id,
            harness.project.id,
            "view_table",
            visibility=PERSONAL,
        )


async def test_personal_view_made_from_shared_publishes_the_removal(monkeypatch, harness) -> None:
    as_role(monkeypatch, ContentRole.EDITOR)
    view = stored_view(monkeypatch, harness, visibility=SHARED, owner_id=harness.user_id)

    await ProjectViewOperations(harness.session).update(
        harness.user_id,
        harness.project.organization_id,
        harness.project.id,
        view.id,
        visibility=PERSONAL,
    )

    assert view.visibility == PERSONAL
    harness.publish.assert_awaited_once()


async def test_layout_cannot_change(monkeypatch, harness) -> None:
    as_role(monkeypatch, ContentRole.EDITOR)
    stored_view(monkeypatch, harness, visibility=SHARED, owner_id=harness.user_id)

    with pytest.raises(ValidationError):
        await ProjectViewOperations(harness.session).update(
            harness.user_id,
            harness.project.organization_id,
            harness.project.id,
            "view_abc",
            definition=ViewDefinition(board=BoardLayout()),
        )


async def test_deleting_the_default_view_clears_it(monkeypatch, harness) -> None:
    as_role(monkeypatch, ContentRole.EDITOR)
    view = stored_view(
        monkeypatch, harness, visibility=SHARED, owner_id=harness.other_id, view_id="view_table"
    )

    await ProjectViewOperations(harness.session).delete(
        harness.user_id, harness.project.organization_id, harness.project.id, view.id
    )

    assert harness.project.default_view_id is None
    harness.session.delete.assert_awaited_once_with(view)
    harness.publish.assert_awaited_once()


async def test_owner_deletes_own_personal_view_quietly(monkeypatch, harness) -> None:
    as_role(monkeypatch, ContentRole.VIEWER)
    stored_view(monkeypatch, harness, visibility=PERSONAL, owner_id=harness.user_id)

    await ProjectViewOperations(harness.session).delete(
        harness.user_id, harness.project.organization_id, harness.project.id, "view_abc"
    )

    assert harness.project.default_view_id == "view_table"
    harness.publish.assert_not_awaited()


def scope(monkeypatch: pytest.MonkeyPatch, *view_ids: str) -> list[SimpleNamespace]:
    views = [SimpleNamespace(id=view_id, sort_order=index) for index, view_id in enumerate(view_ids)]
    monkeypatch.setattr(queries, "get_views_in_scope", AsyncMock(return_value=views))
    return views


async def reorder(harness: Harness, visibility: ProjectViewVisibility, view_ids: list[str]):
    return await ProjectViewOperations(harness.session).reorder(
        harness.user_id,
        harness.project.organization_id,
        harness.project.id,
        visibility=visibility,
        view_ids=view_ids,
    )


async def test_editor_cannot_reorder_shared_views(monkeypatch, harness) -> None:
    as_role(monkeypatch, ContentRole.EDITOR)
    scope(monkeypatch, "view_table", "view_board")

    with pytest.raises(PermissionDeniedError):
        await reorder(harness, SHARED, ["view_board", "view_table"])


async def test_admin_reorders_shared_views(monkeypatch, harness) -> None:
    as_role(monkeypatch, ContentRole.ADMIN)
    table, board = scope(monkeypatch, "view_table", "view_board")

    await reorder(harness, SHARED, ["view_board", "view_table"])

    assert (board.sort_order, table.sort_order) == (0, 1)
    harness.publish.assert_awaited_once()


async def test_viewer_reorders_own_personal_views(monkeypatch, harness) -> None:
    as_role(monkeypatch, ContentRole.VIEWER)
    first, second = scope(monkeypatch, "view_a", "view_b")

    await reorder(harness, PERSONAL, ["view_b", "view_a"])

    assert (second.sort_order, first.sort_order) == (0, 1)
    harness.publish.assert_not_awaited()


@pytest.mark.parametrize(
    "view_ids",
    [["view_table"], ["view_table", "view_board", "view_x"], ["view_table", "view_table"]],
)
async def test_reorder_must_list_the_scope_exactly(monkeypatch, harness, view_ids) -> None:
    as_role(monkeypatch, ContentRole.ADMIN)
    scope(monkeypatch, "view_table", "view_board")

    with pytest.raises(ValidationError):
        await reorder(harness, SHARED, view_ids)
    harness.session.commit.assert_not_awaited()


async def test_publish_failure_does_not_fail_the_mutation(monkeypatch, harness) -> None:
    as_role(monkeypatch, ContentRole.EDITOR)
    harness.publish.side_effect = RuntimeError("valkey down")

    view = await create(harness, SHARED)

    assert view.visibility == SHARED
    harness.session.commit.assert_awaited_once()


async def test_default_view_must_be_a_shared_view_of_the_project(monkeypatch, harness) -> None:
    ops = ProjectOperations(harness.session)
    stored_view(monkeypatch, harness, visibility=PERSONAL, owner_id=harness.user_id)
    with pytest.raises(ValidationError):
        await ops._resolve_default_view_id(harness.project.id, "view_abc")

    monkeypatch.setattr(queries, "get_view", AsyncMock(return_value=None))
    with pytest.raises(ValidationError):
        await ops._resolve_default_view_id(harness.project.id, "view_elsewhere")

    stored_view(monkeypatch, harness, visibility=SHARED, owner_id=harness.other_id)
    assert await ops._resolve_default_view_id(harness.project.id, "view_abc") == "view_abc"
    assert await ops._resolve_default_view_id(harness.project.id, "") is None


def test_validation_errors_map_to_invalid_argument() -> None:
    error = map_domain_error("update_view", ValidationError("definition", "bad"))

    assert error.code == Code.INVALID_ARGUMENT
