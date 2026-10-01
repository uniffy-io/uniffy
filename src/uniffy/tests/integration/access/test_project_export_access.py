"""Task exports reach exactly the projects the caller could open, proven on the rows they return.

Org owners and admins are ordinary members here: a private project of someone else stays out of
their exports, and one hidden project in a request denies the whole export without naming it.
"""

import csv
import io
from types import SimpleNamespace

import pytest
import pytest_asyncio

from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType, generate_id
from uniffy.domains.projects.export.operations import ProjectExportOperations
from uniffy.domains.projects.export.plan import ExportRequest
from uniffy.infrastructure.database import open_session

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _project(access, owner_id, name: str, mode: AccessMode, baseline=None) -> Project:
    return Project(
        organization_id=access.org_id,
        owner_id=owner_id,
        access_mode=mode,
        baseline_role=baseline,
        name=name,
        slug=f"X{generate_id().hex[-6:].upper()}",
    )


@pytest_asyncio.fixture(loop_scope="session")
async def projects(session, access):
    open_project = _project(
        access, access.member_id, "Open", AccessMode.OPEN_TO_ORG, ContentRole.VIEWER
    )
    private = _project(access, access.member_id, "Private", AccessMode.OWNER_ONLY)
    shared = _project(access, access.member_id, "Shared", AccessMode.EXPLICIT_MEMBERS)
    grouped = _project(access, access.member_id, "Grouped", AccessMode.EXPLICIT_MEMBERS)
    session.add_all([open_project, private, shared, grouped])
    await session.flush()
    session.add_all([
        Task(
            project_id=project.id,
            organization_id=access.org_id,
            owner_id=access.member_id,
            title=f"{project.name} task",
            number=1,
            assignee_ids=[str(access.private_group_id)],
        )
        for project in (open_project, private, shared, grouped)
    ])

    def grant(project: Project, subject_type: SubjectType, subject_id, role: ContentRole):
        return ContentMember(
            organization_id=access.org_id,
            content_type=ContentType.PROJECT,
            content_id=project.id,
            subject_type=subject_type,
            subject_id=subject_id,
            role=role,
            added_by_user_id=access.member_id,
        )

    session.add_all([
        grant(shared, SubjectType.USER, access.admin_id, ContentRole.VIEWER),
        grant(grouped, SubjectType.GROUP, access.access_group_id, ContentRole.VIEWER),
        grant(open_project, SubjectType.USER, access.owner_id, ContentRole.BLOCKED),
    ])
    await session.commit()
    return SimpleNamespace(
        open=open_project.id, private=private.id, shared=shared.id, grouped=grouped.id
    )


async def _export(access, user_id, *project_ids) -> list[list[str]]:
    async with open_session() as export_session:
        ops = ProjectExportOperations(export_session)
        plan = await ops.prepare(user_id, ExportRequest(access.org_id, tuple(project_ids)))
        data = b"".join([chunk async for chunk in ops.stream(plan)])
    return list(csv.reader(io.StringIO(data.decode("utf-8-sig"))))[1:]


async def test_a_member_exports_an_open_project(session, access, projects) -> None:
    rows = await _export(access, access.peer_id, projects.open)
    assert [row[0] for row in rows] == ["Open"]


async def test_an_org_admin_cannot_export_another_members_private_project(
    session, access, projects
) -> None:
    with pytest.raises(PermissionDeniedError):
        await _export(access, access.admin_id, projects.private)


async def test_the_org_owner_cannot_export_it_either(session, access, projects) -> None:
    with pytest.raises(PermissionDeniedError):
        await _export(access, access.owner_id, projects.private)


async def test_one_hidden_project_denies_the_whole_request_without_naming_it(
    session, access, projects
) -> None:
    with pytest.raises(PermissionDeniedError) as denied:
        await _export(access, access.admin_id, projects.open, projects.private)
    message = str(denied.value)
    assert str(projects.private) not in message and "Private" not in message


async def test_a_direct_grant_and_a_group_grant_are_honoured(session, access, projects) -> None:
    assert [row[0] for row in await _export(access, access.admin_id, projects.shared)] == [
        "Shared"
    ]
    assert [row[0] for row in await _export(access, access.peer_id, projects.grouped)] == [
        "Grouped"
    ]


async def test_blocked_beats_the_open_baseline(session, access, projects) -> None:
    with pytest.raises(PermissionDeniedError):
        await _export(access, access.owner_id, projects.open)


async def test_a_deactivated_member_and_an_outsider_export_nothing(
    session, access, projects
) -> None:
    for user_id in (access.ghost_id, access.outsider_id):
        with pytest.raises(PermissionDeniedError):
            await _export(access, user_id, projects.open)


async def test_a_private_group_is_named_only_to_its_members(session, access, projects) -> None:
    as_member = await _export(access, access.member_id, projects.open)
    as_peer = await _export(access, access.peer_id, projects.open)

    assigned = as_member[0][7]
    assert assigned and assigned != str(access.private_group_id)
    assert as_peer[0][7] == str(access.private_group_id)
