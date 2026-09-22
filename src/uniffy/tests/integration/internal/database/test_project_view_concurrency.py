"""View privacy and default selection remain consistent across concurrent transactions."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.projects.v1.projects_pb2 import TableLayout, ViewDefinition

from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.view_config import ProjectViewVisibility, ViewConfig
from uniffy.core.search import SearchIndexer
from uniffy.core.types import ContentRole
from uniffy.domains.projects import queries
from uniffy.domains.projects.projects import ProjectOperations
from uniffy.domains.projects.views.operations import ProjectViewOperations
from uniffy.infrastructure.database import open_session
from uniffy.tests.integration.internal.database.test_project_views import (
    _cleanup,
    _create_project,
    _create_view,
    _storage,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")
SHARED = ProjectViewVisibility.SHARED
PERSONAL = ProjectViewVisibility.PERSONAL


@pytest_asyncio.fixture(loop_scope="session")
async def project_view(
    session: AsyncSession,
    env: SimpleNamespace,
    search_indexer: SearchIndexer,
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[tuple[UUID, str]]:
    monkeypatch.setattr(ProjectViewOperations, "_publish_views_changed", AsyncMock())
    project = await _create_project(session, env, search_indexer)
    project_id = project.id
    try:
        await session.execute(
            update(ContentMember)
            .where(
                ContentMember.content_id == project_id,
                ContentMember.subject_id == env.member_id,
            )
            .values(role=ContentRole.EDITOR)
        )
        await session.commit()
        view = await _create_view(session, env, project_id, env.admin_id, SHARED)
        yield project_id, view.id
    finally:
        await _cleanup(session, project_id)


@asynccontextmanager
async def paused_commit(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch, *, after: bool = False
) -> AsyncIterator[tuple[asyncio.Event, asyncio.Event]]:
    ready, release = asyncio.Event(), asyncio.Event()
    commit = session.commit

    async def pause() -> None:
        if after:
            await commit()
        ready.set()
        await release.wait()
        if not after:
            await commit()

    monkeypatch.setattr(session, "commit", pause)
    try:
        yield ready, release
    finally:
        release.set()


async def attempt_change(
    session: AsyncSession,
    env: SimpleNamespace,
    project_id: UUID,
    view_id: str,
    *,
    actor_id: UUID,
    remove: bool = False,
    privatize: bool = False,
) -> ViewConfig | PermissionDeniedError | ValidationError | None:
    ops = ProjectViewOperations(session)
    try:
        if remove:
            return await ops.delete(actor_id, env.org_id, project_id, view_id)
        return await ops.update(
            actor_id,
            env.org_id,
            project_id,
            view_id,
            visibility=PERSONAL if privatize else None,
            name="Changed",
        )
    except (PermissionDeniedError, ValidationError) as exc:
        await session.rollback()
        return exc


@pytest.mark.parametrize("remove", [False, True])
async def test_editor_waits_for_privacy_change_and_cannot_mutate_personal_view(
    project_view, env, monkeypatch, remove
) -> None:
    project_id, view_id = project_view
    async with open_session() as owner, open_session() as editor:
        cached = await queries.get_view(editor, project_id, view_id)
        assert cached.visibility == SHARED
        async with asyncio.timeout(10), asyncio.TaskGroup() as tasks:
            async with paused_commit(owner, monkeypatch) as (ready, release):
                private = tasks.create_task(
                    ProjectViewOperations(owner).update(
                        env.admin_id, env.org_id, project_id, view_id, visibility=PERSONAL
                    )
                )
                await ready.wait()
                editing = tasks.create_task(
                    attempt_change(
                        editor, env, project_id, view_id, actor_id=env.member_id, remove=remove
                    )
                )
                completed, _ = await asyncio.wait([editing], timeout=0.1)
                assert not completed
                release.set()
                await private
                assert isinstance(await editing, PermissionDeniedError)

    async with open_session() as reader:
        saved = await queries.get_view(reader, project_id, view_id)
        assert saved.visibility == PERSONAL
        assert saved.name == "Mine"


async def test_editor_response_excludes_later_private_definition(
    project_view, env, monkeypatch
) -> None:
    project_id, view_id = project_view
    async with open_session() as editor, open_session() as owner:
        async with asyncio.timeout(10), asyncio.TaskGroup() as tasks:
            async with paused_commit(editor, monkeypatch, after=True) as (ready, release):
                editing = tasks.create_task(
                    ProjectViewOperations(editor).update(
                        env.member_id, env.org_id, project_id, view_id, name="Editor rename"
                    )
                )
                await ready.wait()
                private = await ProjectViewOperations(owner).update(
                    env.admin_id,
                    env.org_id,
                    project_id,
                    view_id,
                    visibility=PERSONAL,
                    definition=ViewDefinition(
                        table=TableLayout(), collapsed_group_keys=["private-group"]
                    ),
                )
                assert private.definition["collapsed_group_keys"] == ["private-group"]
                release.set()
                response = await editing
                assert response.visibility == SHARED
                assert response.definition == {"table": {}}


@pytest.mark.parametrize("remove", [False, True])
async def test_default_selection_serializes_with_view_privacy_and_deletion(
    project_view, env, search_indexer, monkeypatch, remove
) -> None:
    project_id, view_id = project_view
    async with open_session() as selector, open_session() as competitor:
        cached = await competitor.get(Project, project_id)
        assert cached.default_view_id != view_id
        async with asyncio.timeout(10), asyncio.TaskGroup() as tasks:
            async with paused_commit(selector, monkeypatch) as (ready, release):
                selection = tasks.create_task(
                    ProjectOperations(selector, _storage(), search_indexer).update(
                        env.admin_id, env.org_id, project_id, default_view_id=view_id
                    )
                )
                await ready.wait()
                changing = tasks.create_task(
                    attempt_change(
                        competitor,
                        env,
                        project_id,
                        view_id,
                        actor_id=env.admin_id,
                        remove=remove,
                        privatize=True,
                    )
                )
                completed, _ = await asyncio.wait([changing], timeout=0.1)
                assert not completed
                release.set()
                await selection
                outcome = await changing
                if remove:
                    assert outcome is None
                else:
                    assert isinstance(outcome, ValidationError)

    async with open_session() as reader:
        default_id = await reader.scalar(
            select(Project.default_view_id).where(Project.id == project_id)
        )
        if remove:
            assert default_id is None
            assert await reader.get(ViewConfig, (view_id, project_id)) is None
        else:
            assert default_id == view_id
            saved = await queries.get_view(reader, project_id, view_id)
            assert saved.visibility == SHARED
