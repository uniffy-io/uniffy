"""Dashboard widgets count only tasks the viewer can read, and layouts save per viewer and org.

Asserted on the rows and counts the aggregates return: org owners and admins are ordinary
members, so another member's private project never reaches their numbers.
"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
import pytest_asyncio

from uniffy.core.errors import ConflictError, MembershipRequiredError
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.projects.field_definition import (
    FieldDefinition,
    ProjectFieldType,
    SystemProjectFieldId,
)
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.sprint import Sprint, SprintStatus
from uniffy.core.models.projects.task import Task, TaskType
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType, generate_id
from uniffy.domains.projects.metrics.queries import TaskMetricsReader
from uniffy.domains.projects.metrics.scope import (
    MetricScope,
    PeopleScope,
    ProjectScope,
    SprintScope,
    resolve_scope,
)
from uniffy.domains.settings.dashboard.definition import Definition, Widget, load_catalog
from uniffy.domains.settings.dashboard.operations import DashboardOperations
from uniffy.domains.settings.operations import SettingsOperations
from uniffy.infrastructure.database import open_session

pytestmark = pytest.mark.asyncio(loop_scope="session")

_STATUS_CONFIG = {
    "options": [
        {"id": "status_todo", "label": "To do", "semantic": "todo"},
        {"id": "status_doing", "label": "Doing", "semantic": "in_progress"},
        {"id": "status_check", "label": "Check", "semantic": "review"},
        {"id": "status_done", "label": "Done", "semantic": "completed"},
    ]
}


def _project(access, owner_id, name: str, mode: AccessMode, baseline=None) -> Project:
    return Project(
        organization_id=access.org_id,
        owner_id=owner_id,
        access_mode=mode,
        baseline_role=baseline,
        name=name,
        slug=f"D{generate_id().hex[-6:].upper()}",
    )


@pytest_asyncio.fixture(loop_scope="session")
async def board(session, access):
    yesterday = (datetime.now(UTC) - timedelta(days=1)).date().isoformat()
    week_ago = (datetime.now(UTC) - timedelta(days=7)).date().isoformat()
    open_project = _project(
        access, access.member_id, "Open", AccessMode.OPEN_TO_ORG, ContentRole.VIEWER
    )
    private = _project(access, access.member_id, "Private", AccessMode.OWNER_ONLY)
    shared = _project(access, access.member_id, "Shared", AccessMode.EXPLICIT_MEMBERS)
    session.add_all([open_project, private, shared])
    await session.flush()
    session.add_all([
        FieldDefinition(
            id=SystemProjectFieldId.STATUS,
            project_id=project.id,
            name="Status",
            type=ProjectFieldType.SINGLE_SELECT,
            config=_STATUS_CONFIG,
        )
        for project in (open_project, private, shared)
    ])
    sprint = Sprint(
        project_id=open_project.id,
        organization_id=access.org_id,
        name="Sprint A",
        status=SprintStatus.ACTIVE,
        start_date=week_ago,
    )
    session.add(sprint)
    await session.flush()

    def task(project, number, **fields) -> Task:
        return Task(
            project_id=project.id,
            organization_id=access.org_id,
            owner_id=access.member_id,
            title=f"{project.name} {number}",
            number=number,
            **fields,
        )

    blocker = task(open_project, 1, assignee_ids=[str(access.ghost_id)], due_date=yesterday)
    session.add(blocker)
    await session.flush()
    session.add_all([
        task(
            open_project,
            2,
            assignee_ids=[str(access.member_id)],
            blocked_by_task_ids=[str(blocker.id)],
            sprint_id=sprint.id,
        ),
        task(open_project, 3, status="status_check", assignee_ids=[str(access.peer_id)]),
        task(
            open_project,
            4,
            completed_at=datetime.now(UTC),
            status="status_done",
            task_type=TaskType.BUG.value,
            sprint_id=sprint.id,
        ),
        task(private, 1, due_date=yesterday, assignee_ids=[str(access.member_id)]),
        task(private, 2, status="status_check"),
        task(shared, 1, due_date=yesterday, task_type=TaskType.BUG.value),
    ])
    session.add_all([
        ContentMember(
            organization_id=access.org_id,
            content_type=ContentType.PROJECT,
            content_id=shared.id,
            subject_type=SubjectType.USER,
            subject_id=access.admin_id,
            role=ContentRole.VIEWER,
            added_by_user_id=access.member_id,
        ),
        ContentMember(
            organization_id=access.org_id,
            content_type=ContentType.PROJECT,
            content_id=open_project.id,
            subject_type=SubjectType.USER,
            subject_id=access.owner_id,
            role=ContentRole.BLOCKED,
            added_by_user_id=access.member_id,
        ),
    ])
    await session.commit()
    return SimpleNamespace(
        open=open_project.id, private=private.id, shared=shared.id, sprint=sprint.id
    )


async def _metric(access, user_id, method: str, scope: MetricScope = MetricScope(), *args):
    async with open_session() as db:
        resolved = await resolve_scope(db, user_id, access.org_id, scope)
        return await getattr(TaskMetricsReader(db, resolved), method)(*args)


async def test_admin_overdue_skips_a_private_project(access, board) -> None:
    overdue = await _metric(access, access.admin_id, "overdue", MetricScope(), 10)
    assert {item.project_id for item in overdue.items} == {board.open, board.shared}
    assert overdue.total == 2


async def test_owner_sees_everything_they_own_and_nothing_blocked(access, board) -> None:
    member = await _metric(access, access.member_id, "overdue", MetricScope(), 10)
    assert member.total == 3
    owner = await _metric(access, access.owner_id, "overdue", MetricScope(), 10)
    assert owner.total == 0


async def test_my_projects_means_owned_or_granted_not_open(access, board) -> None:
    scope = MetricScope(projects=ProjectScope.MY_PROJECTS)
    overdue = await _metric(access, access.admin_id, "overdue", scope, 10)
    assert {item.project_id for item in overdue.items} == {board.shared}


async def test_selected_projects_stay_limited_to_readable_ones(access, board) -> None:
    scope = MetricScope(projects=ProjectScope.SELECTED, project_ids=(board.private, board.open))
    overdue = await _metric(access, access.admin_id, "overdue", scope, 10)
    assert {item.project_id for item in overdue.items} == {board.open}


async def test_me_and_my_teams_resolve_for_the_viewer(access, board) -> None:
    mine = await _metric(
        access, access.member_id, "overdue", MetricScope(people=PeopleScope.ME), 10
    )
    assert [item.project_id for item in mine.items] == [board.private]
    # The team holds member and ghost; peer's membership is inactive.
    _, rows = await _metric(
        access, access.member_id, "workload", MetricScope(people=PeopleScope.MY_TEAMS), 10
    )
    assert {row.user_id for row in rows} == {str(access.member_id), str(access.ghost_id)}


async def test_blocked_and_review_queue_follow_project_semantics(access, board) -> None:
    blocked = await _metric(access, access.peer_id, "blocked", MetricScope(), 10)
    assert [item.number for item in blocked.items] == [2]
    review = await _metric(access, access.admin_id, "review_queue", MetricScope(), 10)
    assert [(item.project_id, item.number) for item in review.items] == [(board.open, 3)]


async def test_status_bug_trend_and_sprints_respect_access(access, board) -> None:
    rows = await _metric(access, access.admin_id, "status_by_project", MetricScope(), 10)
    by_project = {row.project_id: row for row in rows}
    assert set(by_project) == {board.open, board.shared}
    open_counts = by_project[board.open]
    assert (open_counts.todo, open_counts.review, open_counts.completed) == (2, 1, 1)
    assert (open_counts.top_level_total, open_counts.top_level_completed) == (4, 1)
    assert open_counts.overdue == 1
    mine = await _metric(
        access, access.member_id, "status_by_project", MetricScope(people=PeopleScope.ME), 10
    )
    # Health under Me scores only the viewer's own tasks: one open task in Open, one overdue
    # task in Private.
    by_mine = {row.project_id: row for row in mine}
    assert (by_mine[board.open].top_level_total, by_mine[board.open].overdue) == (1, 0)
    assert (by_mine[board.private].top_level_total, by_mine[board.private].overdue) == (1, 1)
    bugs = await _metric(access, access.admin_id, "bug_trend", MetricScope(), 7)
    assert sum(day.opened for day in bugs) == 2
    assert sum(day.closed for day in bugs) == 1
    sprints = await _metric(access, access.admin_id, "sprints", MetricScope(), 5)
    assert [(s.sprint_id, s.total, s.completed) for s in sprints] == [(board.sprint, 2, 1)]
    assert sprints[0].burndown[-1][1] == 1
    active = await _metric(
        access, access.admin_id, "overdue", MetricScope(sprint=SprintScope.ACTIVE), 10
    )
    assert active.total == 0


async def test_sprints_under_me_skip_sprints_without_the_viewers_work(
    session, access, board
) -> None:
    session.add(
        Sprint(
            project_id=board.shared,
            organization_id=access.org_id,
            name="Sprint 0",
            status=SprintStatus.ACTIVE,
            end_date=datetime.now(UTC).date().isoformat(),
        )
    )
    await session.commit()
    everyone = await _metric(access, access.member_id, "sprints", MetricScope(), 1)
    assert [s.name for s in everyone] == ["Sprint 0"]
    mine = await _metric(
        access, access.member_id, "sprints", MetricScope(people=PeopleScope.ME), 1
    )
    assert [(s.sprint_id, s.total) for s in mine] == [(board.sprint, 1)]


async def test_project_refs_name_only_readable_projects(access, board) -> None:
    async with open_session() as db:
        resolved = await resolve_scope(db, access.admin_id, access.org_id, MetricScope())
        refs = await TaskMetricsReader(db, resolved).project_refs(
            {board.open, board.shared, board.private}
        )
    assert {ref.project_id: ref.name for ref in refs} == {
        board.open: "Open",
        board.shared: "Shared",
    }


async def test_a_non_member_counts_nothing(access, board) -> None:
    assert (await _metric(access, access.outsider_id, "overdue", MetricScope(), 10)).total == 0


async def test_layout_saves_per_viewer_with_revision_checks(access, board) -> None:
    catalog = load_catalog()
    layout = Definition(widgets=(Widget("overdue-tasks"), Widget("my-tasks")))
    async with open_session() as db:
        ops = DashboardOperations(db)
        assert (await ops.get(access.peer_id, access.org_id)).definition is None
        saved = await ops.save(access.peer_id, access.org_id, layout, 0, keep_previous=False)
        assert saved.revision == 1
        with pytest.raises(ConflictError):
            await ops.save(access.peer_id, access.org_id, layout, 0, keep_previous=False)
        preset = catalog.preset("qa")
        assert preset is not None
        applied = await ops.save(
            access.peer_id, access.org_id, preset.definition, 1, keep_previous=True
        )
        assert applied.has_previous and applied.definition.preset == "qa"
        renamed = await ops.save(
            access.peer_id,
            access.org_id,
            Definition(widgets=applied.definition.widgets, name="My QA"),
            applied.revision,
            keep_previous=False,
        )
        assert renamed.has_previous and renamed.definition.name == "My QA"
        applied = renamed
        restored = await ops.restore_previous(access.peer_id, access.org_id, applied.revision)
        assert [w.widget_id for w in restored.definition.widgets] == ["overdue-tasks", "my-tasks"]
        assert not restored.has_previous
        assert (await ops.get(access.admin_id, access.org_id)).definition is None
        with pytest.raises(MembershipRequiredError):
            await ops.get(access.outsider_id, access.org_id)


async def test_a_save_from_a_stale_read_is_refused(access, board) -> None:
    layout = Definition(widgets=(Widget("overdue-tasks"),))
    other = Definition(widgets=(Widget("my-tasks"),))
    async with open_session() as db:
        await DashboardOperations(db).save(
            access.peer_id, access.org_id, other, 0, keep_previous=False
        )
    async with open_session() as stale, open_session() as fresh:
        stale_ops = DashboardOperations(stale)
        # Holding the profile keeps this session's copy alive across the other save, the window
        # between the unlocked read and the row lock.
        held = await SettingsOperations(stale).get_default_profile(access.peer_id)
        assert held is not None
        await DashboardOperations(fresh).save(
            access.peer_id, access.org_id, layout, 1, keep_previous=False
        )
        with pytest.raises(ConflictError):
            await stale_ops.save(access.peer_id, access.org_id, other, 1, keep_previous=False)
    async with open_session() as db:
        stored = await DashboardOperations(db).get(access.peer_id, access.org_id)
    assert [w.widget_id for w in stored.definition.widgets] == ["overdue-tasks"]
