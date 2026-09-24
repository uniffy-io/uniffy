"""Project views on real rows: who sees which view, and what follows a view's removal."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
from protobuf import Oneof
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.projects.v1.projects_pb import (
    FilterLogic,
    TableLayout,
    TaskFieldRef,
    TaskFilterCondition,
    TaskFilterGroup,
    TaskFilterNode,
    TaskFilterOperator,
    TaskFilterValue,
    ViewDefinition,
)

from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.projects.field_definition import FieldDefinition, ProjectFieldType
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.view_config import (
    DefaultProjectViewId,
    ProjectViewVisibility,
    ViewConfig,
)
from uniffy.core.search import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType, generate_id
from uniffy.domains.projects import queries
from uniffy.domains.projects.operations import ProjectOperations, ProjectViewOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")

SHARED = ProjectViewVisibility.SHARED
PERSONAL = ProjectViewVisibility.PERSONAL


@pytest.fixture(autouse=True)
def quiet_realtime():
    with patch(
        "uniffy.domains.projects.audience.publish_content_access_changed",
        AsyncMock(),
    ):
        yield


def _storage() -> ObjectStorage:
    storage = MagicMock(spec=ObjectStorage)
    storage.bucket_name = "test"
    return storage


async def _create_project(
    session: AsyncSession, env: SimpleNamespace, search_indexer: SearchIndexer
) -> Project:
    project = await ProjectOperations(session, _storage(), search_indexer).create(
        user_id=env.admin_id,
        organization_id=env.org_id,
        name=f"Views {generate_id().hex[:10]}",
        access_mode=AccessMode.EXPLICIT_MEMBERS,
    )
    session.add(
        ContentMember(
            organization_id=env.org_id,
            content_type=ContentType.PROJECT,
            content_id=project.id,
            subject_type=SubjectType.USER,
            subject_id=env.member_id,
            role=ContentRole.VIEWER,
            added_by_user_id=env.admin_id,
        )
    )
    await session.commit()
    return project


async def _cleanup(session: AsyncSession, project_id: UUID) -> None:
    await session.rollback()
    await session.execute(delete(ViewConfig).where(ViewConfig.project_id == project_id))
    await session.execute(delete(FieldDefinition).where(FieldDefinition.project_id == project_id))
    await session.execute(delete(Project).where(Project.id == project_id))
    await session.commit()


async def _create_view(
    session: AsyncSession,
    env: SimpleNamespace,
    project_id: UUID,
    user_id: UUID,
    visibility: ProjectViewVisibility,
) -> ViewConfig:
    return await ProjectViewOperations(session).create(
        user_id,
        env.org_id,
        project_id,
        name="Mine",
        definition=ViewDefinition(layout=Oneof(field="table", value=TableLayout())),
        visibility=visibility,
    )


async def test_new_project_starts_with_six_shared_views(session, env, search_indexer) -> None:
    project = await _create_project(session, env, search_indexer)
    project_id = project.id
    try:
        views = await queries.get_views_for_project(session, project_id, env.member_id)

        assert [view.id for view in views] == [view_id.value for view_id in DefaultProjectViewId]
        assert [view.sort_order for view in views] == list(range(6))
        assert all(view.visibility == SHARED for view in views)
        assert all(view.owner_id == env.admin_id for view in views)
        assert all(view.organization_id == env.org_id for view in views)
        assert project.default_view_id == DefaultProjectViewId.TABLE
    finally:
        await _cleanup(session, project_id)


async def test_personal_views_stay_with_their_owner(session, env, search_indexer) -> None:
    project = await _create_project(session, env, search_indexer)
    project_id = project.id
    try:
        personal = await _create_view(session, env, project_id, env.member_id, PERSONAL)

        owner_sees = await queries.get_views_for_project(session, project_id, env.admin_id)
        member_sees = await queries.get_views_for_project(session, project_id, env.member_id)
        listed = await queries.get_views_for_projects(session, [project_id], env.admin_id)

        assert personal.id not in {view.id for view in owner_sees}
        assert personal.id not in {view.id for view in listed[str(project_id)]}
        assert [view.id for view in member_sees][-1] == personal.id
        assert len(member_sees) == len(owner_sees) + 1
    finally:
        await _cleanup(session, project_id)


async def test_viewer_cannot_create_a_shared_view(session, env, search_indexer) -> None:
    project = await _create_project(session, env, search_indexer)
    project_id = project.id
    try:
        with pytest.raises(PermissionDeniedError):
            await _create_view(session, env, project_id, env.member_id, SHARED)
    finally:
        await _cleanup(session, project_id)


async def test_default_view_rules_hold_on_real_rows(session, env, search_indexer) -> None:
    project = await _create_project(session, env, search_indexer)
    project_id = project.id
    try:
        personal = await _create_view(session, env, project_id, env.admin_id, PERSONAL)
        personal_id = personal.id
        projects = ProjectOperations(session, _storage(), search_indexer)
        with pytest.raises(ValidationError):
            await projects.update(env.admin_id, env.org_id, project_id, default_view_id=personal_id)
        await session.rollback()

        await ProjectViewOperations(session).delete(
            env.admin_id, env.org_id, project_id, DefaultProjectViewId.TABLE
        )
        stored = await session.scalar(
            select(Project.default_view_id).where(Project.id == project_id)
        )
        assert stored is None

        updated = await projects.update(
            env.admin_id, env.org_id, project_id, default_view_id=DefaultProjectViewId.BOARD
        )
        assert updated.default_view_id == DefaultProjectViewId.BOARD
    finally:
        await _cleanup(session, project_id)


async def test_reorder_persists_the_shared_order(session, env, search_indexer) -> None:
    project = await _create_project(session, env, search_indexer)
    project_id = project.id
    try:
        order = [view_id.value for view_id in reversed(DefaultProjectViewId)]
        await ProjectViewOperations(session).reorder(
            env.admin_id, env.org_id, project_id, visibility=SHARED, view_ids=order
        )

        stored = await session.execute(
            select(ViewConfig.id)
            .where(ViewConfig.project_id == project_id)
            .order_by(ViewConfig.sort_order)
        )
        views = stored.scalars().all()
        assert list(views) == order
    finally:
        await _cleanup(session, project_id)


async def test_view_on_a_deleted_field_loads_but_no_longer_saves(
    session, env, search_indexer
) -> None:
    project = await _create_project(session, env, search_indexer)
    project_id = project.id
    try:
        session.add(
            FieldDefinition(
                id="field_effort",
                project_id=project_id,
                name="Effort",
                type=ProjectFieldType.NUMBER,
                sort_order=100,
            )
        )
        await session.commit()
        definition = ViewDefinition(
            layout=Oneof(field="table", value=TableLayout()),
            filter=TaskFilterGroup(
                logic=FilterLogic.AND,
                nodes=[
                    TaskFilterNode(
                        node=Oneof(
                            field="condition",
                            value=TaskFilterCondition(
                                field=TaskFieldRef(
                                    ref=Oneof(field="field_id", value="field_effort")
                                ),
                                operator=TaskFilterOperator.GREATER_THAN,
                                value=TaskFilterValue(value=Oneof(field="number", value=3)),
                            ),
                        )
                    )
                ],
            ),
        )
        view = await ProjectViewOperations(session).create(
            env.admin_id,
            env.org_id,
            project_id,
            name="Effort",
            definition=definition,
            visibility=SHARED,
        )
        view_id = view.id

        await session.execute(
            delete(FieldDefinition)
            .where(FieldDefinition.id == "field_effort")
            .where(FieldDefinition.project_id == project_id)
        )
        await session.commit()

        stored = await queries.get_view(session, project_id, view_id)
        assert stored is not None
        assert stored.definition["filter"]["nodes"][0]["condition"]["field"]["field_id"] == (
            "field_effort"
        )

        with pytest.raises(ValidationError) as exc:
            await ProjectViewOperations(session).update(
                env.admin_id, env.org_id, project_id, view_id, definition=definition
            )
        assert exc.value.message == "Filter condition 1: unknown field 'field_effort'"
    finally:
        await _cleanup(session, project_id)


async def test_permanent_project_delete_removes_every_view(session, env, search_indexer) -> None:
    project = await _create_project(session, env, search_indexer)
    project_id = project.id
    await _create_view(session, env, project_id, env.member_id, PERSONAL)

    await ProjectOperations(session, _storage(), search_indexer).delete(
        env.admin_id, env.org_id, project_id, permanent=True
    )

    remaining = await session.scalar(
        select(ViewConfig.id).where(ViewConfig.project_id == project_id).limit(1)
    )
    assert remaining is None
