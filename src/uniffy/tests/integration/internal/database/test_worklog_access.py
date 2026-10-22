"""Time records on the live database: gates proven on returned rows, rollup proven on the task row."""

from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock
from uuid import UUID

import pytest
from sqlalchemy import delete, select

from uniffy.core.errors import PermissionDeniedError, UNIFFYError
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.projects.activity import TaskActivity
from uniffy.core.models.projects.field_definition import FieldDefinition
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.models.projects.task_watcher import TaskWatcher
from uniffy.core.models.projects.view_config import ViewConfig
from uniffy.core.models.projects.worklog import Worklog, WorklogSource
from uniffy.core.types import AccessMode, ContentRole, generate_id
from uniffy.domains.projects.projects import ProjectOperations
from uniffy.domains.projects.tasks.operations import TaskOperations
from uniffy.domains.projects.time.worklogs import AggregateGroupBy, WorklogOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")

TODAY = datetime.now(UTC).date()
LAST_YEAR = TODAY - timedelta(days=300)


async def _make_project(session, env, search_indexer, *, access_mode, baseline_role=None) -> UUID:
    """Returns the id only: a later rollback expires ORM rows, and ids must stay readable."""
    project = await ProjectOperations(session, search_indexer=search_indexer).create(
        user_id=env.admin_id,
        organization_id=env.org_id,
        name=f"Time {generate_id().hex[:8]}",
        access_mode=access_mode,
        baseline_role=baseline_role,
    )
    return project.id


async def _make_task(session, env, search_indexer, buffer, project_id: UUID) -> UUID:
    ops = TaskOperations(session, storage=MagicMock(), search_indexer=search_indexer, buffer=buffer)
    task = await ops.create(
        user_id=env.admin_id,
        organization_id=env.org_id,
        project_id=project_id,
        title="Worklog task",
        task_type="task",
    )
    return task.id


async def _rollup(session, task_id: UUID) -> int | None:
    """A column read bypasses the identity map, so it sees the committed value."""
    return (
        await session.execute(select(Task.time_spent_minutes).where(Task.id == task_id))
    ).scalar_one()


async def _cleanup(session, project_id: UUID) -> None:
    await session.rollback()
    task_ids = list(
        (await session.execute(select(Task.id).where(Task.project_id == project_id))).scalars()
    )
    if task_ids:
        await session.execute(delete(Worklog).where(Worklog.task_id.in_(task_ids)))
        await session.execute(delete(TaskWatcher).where(TaskWatcher.task_id.in_(task_ids)))
        await session.execute(delete(TaskActivity).where(TaskActivity.task_id.in_(task_ids)))
        await session.execute(delete(Task).where(Task.id.in_(task_ids)))
    await session.execute(delete(ViewConfig).where(ViewConfig.project_id == project_id))
    await session.execute(delete(FieldDefinition).where(FieldDefinition.project_id == project_id))
    await session.execute(delete(Project).where(Project.id == project_id))
    await session.commit()


async def test_rollup_tracks_every_write_and_imported_history_is_exempt_from_caps(
    session, env, search_indexer, buffer
) -> None:
    project_id = await _make_project(
        session,
        env,
        search_indexer,
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.VIEWER,
    )
    try:
        task_id = await _make_task(session, env, search_indexer, buffer, project_id)
        ops = WorklogOperations(session)

        row, rollup = await ops.create(
            env.member_id, env.org_id, task_id, work_date=TODAY, duration_minutes=45
        )
        first_id = row.worklog.id
        assert rollup == 45
        assert await _rollup(session, task_id) == 45

        _, rollup = await ops.create(
            env.member_id, env.org_id, task_id, work_date=TODAY, duration_minutes=30
        )
        assert rollup == 75

        _, rollup = await ops.update(env.member_id, env.org_id, first_id, duration_minutes=60)
        assert rollup == 90
        assert await _rollup(session, task_id) == 90

        # Backfilled history: one row carrying a whole historical total, above both caps.
        session.add(
            Worklog(
                organization_id=env.org_id,
                task_id=task_id,
                user_id=env.admin_id,
                created_by_user_id=env.admin_id,
                work_date=LAST_YEAR,
                duration_minutes=3000,
                source=WorklogSource.IMPORT,
            )
        )
        await session.commit()
        listed, next_token = await ops.list_for_task(env.member_id, env.org_id, task_id)
        assert next_token == ""
        assert sorted(r.worklog.duration_minutes for r in listed) == [30, 60, 3000]

        rows = await ops.aggregate(
            env.member_id,
            env.org_id,
            from_date=LAST_YEAR,
            to_date=TODAY,
            group_by=AggregateGroupBy.USER,
            project_id=project_id,
        )
        assert {r.key: r.minutes for r in rows} == {
            str(env.member_id): 90,
            str(env.admin_id): 3000,
        }

        deleted_task_id, rollup = await ops.delete(env.member_id, env.org_id, first_id)
        assert deleted_task_id == task_id
        assert rollup == 3030
        assert await _rollup(session, task_id) == 3030

        await session.execute(delete(Worklog).where(Worklog.task_id == task_id))
        await session.commit()
        await ops.stage_task_rollup(task_id)
        await session.commit()
        assert await _rollup(session, task_id) is None
    finally:
        await _cleanup(session, project_id)


async def test_an_admin_who_is_not_a_reviewer_cannot_read_another_persons_week(
    session, env, search_indexer, buffer
) -> None:
    project_id = await _make_project(
        session,
        env,
        search_indexer,
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.VIEWER,
    )
    try:
        task_id = await _make_task(session, env, search_indexer, buffer, project_id)
        ops = WorklogOperations(session)
        await ops.create(env.member_id, env.org_id, task_id, work_date=TODAY, duration_minutes=20)

        # Nobody is named as the member's reviewer, so the admin fallback applies.
        own = await ops.list_for_user(
            env.member_id, env.org_id, env.member_id, from_date=TODAY, to_date=TODAY
        )
        assert [r.worklog.duration_minutes for r in own] == [20]
        as_admin = await ops.list_for_user(
            env.admin_id, env.org_id, env.member_id, from_date=TODAY, to_date=TODAY
        )
        assert [r.worklog.duration_minutes for r in as_admin] == [20]

        # The member reviews nobody and is no admin: the admin's week is closed to them.
        with pytest.raises(PermissionDeniedError):
            await ops.list_for_user(
                env.member_id, env.org_id, env.admin_id, from_date=TODAY, to_date=TODAY
            )
    finally:
        await _cleanup(session, project_id)


async def test_project_aggregates_follow_project_view(session, env, search_indexer, buffer) -> None:
    private_id = await _make_project(session, env, search_indexer, access_mode=AccessMode.OWNER_ONLY)
    shared_id = await _make_project(
        session,
        env,
        search_indexer,
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.VIEWER,
    )
    try:
        private_task = await _make_task(session, env, search_indexer, buffer, private_id)
        shared_task = await _make_task(session, env, search_indexer, buffer, shared_id)
        ops = WorklogOperations(session)
        await ops.create(
            env.admin_id, env.org_id, private_task, work_date=TODAY, duration_minutes=15
        )
        await ops.create(env.admin_id, env.org_id, shared_task, work_date=TODAY, duration_minutes=25)

        with pytest.raises(UNIFFYError):
            await ops.aggregate(
                env.member_id,
                env.org_id,
                from_date=TODAY,
                to_date=TODAY,
                group_by=AggregateGroupBy.TASK,
                project_id=private_id,
            )
        with pytest.raises(UNIFFYError):
            await ops.list_for_task(env.member_id, env.org_id, private_task)

        rows = await ops.aggregate(
            env.member_id,
            env.org_id,
            from_date=TODAY,
            to_date=TODAY,
            group_by=AggregateGroupBy.TASK,
            project_id=shared_id,
        )
        assert [(r.key, r.minutes) for r in rows] == [(str(shared_task), 25)]
        listed, _ = await ops.list_for_task(env.member_id, env.org_id, shared_task)
        assert [r.worklog.duration_minutes for r in listed] == [25]
    finally:
        await _cleanup(session, private_id)
        await _cleanup(session, shared_id)


async def test_a_deactivated_member_reaches_nothing(session, env, search_indexer, buffer) -> None:
    project_id = await _make_project(
        session,
        env,
        search_indexer,
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.EDITOR,
    )
    try:
        task_id = await _make_task(session, env, search_indexer, buffer, project_id)
        ops = WorklogOperations(session)
        row, _ = await ops.create(
            env.member_id, env.org_id, task_id, work_date=TODAY, duration_minutes=10
        )
        entry_id = row.worklog.id

        membership = (
            await session.execute(
                select(OrganizationMember).where(
                    OrganizationMember.user_id == env.member_id,
                    OrganizationMember.organization_id == env.org_id,
                )
            )
        ).scalar_one()
        membership.is_active = False
        await session.commit()

        with pytest.raises(UNIFFYError):
            await ops.create(env.member_id, env.org_id, task_id, work_date=TODAY, duration_minutes=5)
        with pytest.raises(PermissionDeniedError):
            await ops.list_for_user(
                env.member_id, env.org_id, env.member_id, from_date=TODAY, to_date=TODAY
            )
        with pytest.raises(PermissionDeniedError):
            await ops.update(env.member_id, env.org_id, entry_id, duration_minutes=20)
        with pytest.raises(PermissionDeniedError):
            await ops.delete(env.member_id, env.org_id, entry_id)
        with pytest.raises(UNIFFYError):
            await ops.list_for_task(env.member_id, env.org_id, task_id)
        assert await _rollup(session, task_id) == 10
    finally:
        await _cleanup(session, project_id)
