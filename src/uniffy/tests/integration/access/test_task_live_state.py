from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.sprint import Sprint as _Sprint  # noqa: F401 - FK metadata
from uniffy.core.models.projects.task import Task
from uniffy.core.search.workspace import DocumentLookupResult, WorkspaceSearch
from uniffy.core.types import AccessMode, ContentRole, generate_id
from uniffy.domains.permissions.access import MAX_RESOURCE_PAGE
from uniffy.domains.search.operations import SearchOperations
from uniffy.domains.search.queries import UrnAvailability

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _project(
    session: AsyncSession,
    organization_id: UUID,
    owner_id: UUID,
    access_mode: AccessMode,
) -> Project:
    project = Project(
        organization_id=organization_id,
        owner_id=owner_id,
        name="Task preview access",
        slug=f"preview-{generate_id().hex[-12:]}",
        access_mode=access_mode,
        baseline_role=ContentRole.VIEWER if access_mode == AccessMode.OPEN_TO_ORG else None,
    )
    session.add(project)
    await session.flush()
    return project


def _task(project: Project, number: int) -> Task:
    return Task(
        organization_id=project.organization_id,
        project_id=project.id,
        owner_id=project.owner_id,
        title=f"Task {number}",
        number=number,
    )


def _search_with_preview(task: Task) -> WorkspaceSearch:
    search = MagicMock(spec=WorkspaceSearch)
    search.get_documents_by_urns = AsyncMock(
        return_value=DocumentLookupResult(
            documents={
                task.urn: {
                    "urn": task.urn,
                    "organization_id": str(task.organization_id),
                    "owner_id": str(task.owner_id),
                    "title": task.title,
                    "entity_type": "task",
                    "access_mode": AccessMode.OPEN_TO_ORG.value,
                }
            },
            failed_urns=frozenset(),
        )
    )
    return search


@pytest.mark.parametrize("viewer_attribute", ["peer_id", "admin_id"])
@pytest.mark.parametrize("foreign_blocker", [False, True])
async def test_private_blocker_completion_is_not_exposed(
    session: AsyncSession,
    access: SimpleNamespace,
    viewer_attribute: str,
    foreign_blocker: bool,
) -> None:
    shared = await _project(session, access.org_id, access.member_id, AccessMode.OPEN_TO_ORG)
    private = await _project(
        session,
        access.other_org_id if foreign_blocker else access.org_id,
        access.outsider_id if foreign_blocker else access.member_id,
        AccessMode.OWNER_ONLY,
    )
    source = _task(shared, 1)
    blocker = _task(private, 1)
    source.blocked_by_task_ids = [str(blocker.id)]
    session.add_all([source, blocker])
    await session.flush()
    search = _search_with_preview(source)
    viewer_id = getattr(access, viewer_attribute)

    for completed_at in (None, datetime.now(UTC)):
        blocker.completed_at = completed_at
        session.add(blocker)
        await session.flush()
        results = await SearchOperations(session, search).resolve_urns(
            viewer_id, access.org_id, [source.urn, blocker.urn]
        )
        assert results[source.urn].availability is UrnAvailability.AVAILABLE
        assert results[blocker.urn].availability is not UrnAvailability.AVAILABLE
        assert results[source.urn].blocked_by_count == 0


async def test_visible_blockers_count_across_authorization_pages(
    session: AsyncSession, access: SimpleNamespace
) -> None:
    project = await _project(session, access.org_id, access.member_id, AccessMode.OPEN_TO_ORG)
    source = _task(project, 1)
    blockers = [_task(project, number + 2) for number in range(MAX_RESOURCE_PAGE + 1)]
    completed = _task(project, MAX_RESOURCE_PAGE + 3)
    completed.completed_at = datetime.now(UTC)
    deleted = _task(project, MAX_RESOURCE_PAGE + 4)
    deleted.is_deleted = True
    source.blocked_by_task_ids = [
        *(str(task.id) for task in blockers),
        str(completed.id),
        str(deleted.id),
        str(generate_id()),
        "invalid-id",
    ]
    session.add_all([source, *blockers, completed, deleted])
    await session.flush()
    search = _search_with_preview(source)

    results = await SearchOperations(session, search).resolve_urns(
        access.peer_id, access.org_id, [source.urn]
    )
    assert results[source.urn].blocked_by_count == len(blockers)

    blockers[0].completed_at = datetime.now(UTC)
    session.add(blockers[0])
    await session.flush()
    results = await SearchOperations(session, search).resolve_urns(
        access.peer_id, access.org_id, [source.urn]
    )
    assert results[source.urn].blocked_by_count == len(blockers) - 1

    source.completed_at = datetime.now(UTC)
    session.add(source)
    await session.flush()
    results = await SearchOperations(session, search).resolve_urns(
        access.peer_id, access.org_id, [source.urn]
    )
    assert results[source.urn].blocked_by_count == 0
