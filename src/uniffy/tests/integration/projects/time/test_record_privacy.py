"""Member records retain totals without extending access to referenced task metadata."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import delete, select, update

from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.login.user import User
from uniffy.core.models.platform.support_session import (
    SupportSession,
    SupportSessionScope,
    SupportSessionState,
)
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.types import AccessMode, generate_id
from uniffy.domains.projects.time.access import TimeAccess
from uniffy.domains.projects.time.converters import timer_to_proto
from uniffy.domains.projects.time.timers import TimerOperations
from uniffy.domains.projects.time.worklogs import AggregateGroupBy, WorklogOperations
from uniffy.tests.integration.projects.time.test_timesheet_locks import _log, _reset, world

pytestmark = pytest.mark.asyncio(loop_scope="session")
TODAY = datetime.now(UTC).date()


async def test_read_only_support_cannot_create_member_worklog(session, world):
    await _reset(session, world)
    suffix = generate_id().hex
    support = User(
        email=f"time-support-{suffix}@test.local",
        username=f"time-support-{suffix}",
        hashed_password="x",
        is_system_admin=True,
    )
    session.add(support)
    await session.flush()
    support_id = support.id
    grant = SupportSession(
        organization_id=world.org,
        support_user_id=support_id,
        requested_by_user_id=support_id,
        granted_by_user_id=world.owner,
        reason="Read-only access",
        scope=SupportSessionScope.READ_ONLY,
        state=SupportSessionState.ACTIVE,
        expires_at=datetime.now(UTC) + timedelta(minutes=5),
    )
    session.add(grant)
    await session.commit()
    try:
        assert await TimeAccess(session).require_task_view(support_id, world.org, world.task_id)
        with pytest.raises(PermissionDeniedError):
            await WorklogOperations(session).create(
                support_id, world.org, world.task_id, work_date=TODAY, duration_minutes=15
            )
    finally:
        await session.rollback()
        await session.execute(
            delete(SupportSession).where(SupportSession.support_user_id == support_id)
        )
        await session.execute(delete(User).where(User.id == support_id))
        await session.commit()


async def test_person_aggregate_masks_restricted_labels_without_dropping_minutes(session, world):
    await _reset(session, world)
    await _log(session, world, world.worker, TODAY)
    project_id = await session.scalar(select(Task.project_id).where(Task.id == world.task_id))
    await session.execute(
        update(Project)
        .where(Project.id == project_id)
        .values(owner_id=world.owner, access_mode=AccessMode.OWNER_ONLY, name="Confidential project")
    )
    await session.execute(
        update(Task).where(Task.id == world.task_id).values(title="Confidential task")
    )
    await session.commit()
    with pytest.raises(PermissionDeniedError):
        await TimeAccess(session).require_task_view(world.reviewer, world.org, world.task_id)
    for group in (AggregateGroupBy.TASK, AggregateGroupBy.PROJECT):
        rows = await WorklogOperations(session).aggregate(
            world.reviewer,
            world.org,
            user_id=world.worker,
            from_date=TODAY,
            to_date=TODAY,
            group_by=group,
        )
        assert len(rows) == 1
        assert rows[0].label == ""
        assert rows[0].minutes == 60 and rows[0].entries == 1
        assert rows[0].key == str(world.task_id if group is AggregateGroupBy.TASK else project_id)
    visible_rows = await WorklogOperations(session).aggregate(
        world.owner,
        world.org,
        project_id=project_id,
        from_date=TODAY,
        to_date=TODAY,
        group_by=AggregateGroupBy.TASK,
    )
    assert visible_rows[0].label == "Confidential task"
    await session.rollback()


async def test_revoked_timer_masks_live_metadata_but_allows_pause_resume_and_discard(session, world):
    await _reset(session, world)
    with patch("uniffy.domains.projects.time.timers.publish_notification", new=AsyncMock()):
        await TimerOperations(session).start(world.worker, world.org, world.task_id, work_date=TODAY)
        project_id = await session.scalar(select(Task.project_id).where(Task.id == world.task_id))
        await session.execute(
            update(Project)
            .where(Project.id == project_id)
            .values(
                owner_id=world.owner,
                access_mode=AccessMode.OWNER_ONLY,
                slug=f"secret-{generate_id().hex[-8:]}",
            )
        )
        await session.execute(
            update(Task)
            .where(Task.id == world.task_id)
            .values(title="New confidential title", time_spent_minutes=500)
        )
        await session.commit()
        with pytest.raises(PermissionDeniedError):
            await TimeAccess(session).require_task_view(world.worker, world.org, world.task_id)
        ops = TimerOperations(session)
        for row in (
            await ops.get_active(world.worker, world.org),
            await ops.pause(world.worker, world.org),
            await ops.resume(world.worker, world.org),
        ):
            assert row.timer.task_id == world.task_id
            assert row.task_title == row.project_slug == ""
            assert row.project_id is None
            assert row.task_number == 0
            assert timer_to_proto(row).project_id == ""
        result = await ops.stop(world.worker, world.org, work_date=None, discard=True)
        assert result.worklog is None and result.task_time_spent_minutes == 0
        assert await ops.get_active(world.worker, world.org) is None
    await session.rollback()
