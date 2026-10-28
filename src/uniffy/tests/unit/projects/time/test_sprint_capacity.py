from datetime import UTC, date, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.domains.projects.time.policy import ResolvedTimePolicy
from uniffy.domains.projects.time.sprint_capacity import SprintCapacityReader, split_estimate
from uniffy.domains.scheduling.calendar.availability import BusyInterval

MODULE = "uniffy.domains.projects.time.sprint_capacity"
CAPACITY = "uniffy.domains.projects.time.capacity"
ORG = uuid4()
ACTOR = uuid4()
PROJECT = uuid4()
SPRINT = uuid4()
ALICE = uuid4()
BOB = uuid4()
TEAM = uuid4()
GONE = uuid4()
TASK_SOLO, TASK_TEAM, TASK_BOB = uuid4(), uuid4(), uuid4()
TWO_WEEKS = 4800
HOLIDAY = 480
AWAY_DAY = 480


def _sprint(start: str | None = "2026-10-12", end: str | None = "2026-10-25"):
    return SimpleNamespace(id=SPRINT, project_id=PROJECT, start_date=start, end_date=end)


class _Session:
    def __init__(self, sprint, tasks: list) -> None:  # noqa: ANN001
        self.sprint = sprint
        self.tasks = tasks
        self.statements: list[str] = []

    async def execute(self, stmt):  # noqa: ANN001
        sql = " ".join(str(stmt.compile(compile_kwargs={"literal_binds": True})).lower().split())
        self.statements.append(sql)
        result = MagicMock()
        if "from projects_sprints" in sql:
            result.scalar_one_or_none.return_value = self.sprint
        elif "from projects_tasks" in sql:
            assert "projects_tasks.is_deleted is false" in sql
            result.all.return_value = self.tasks
        elif "from login_group_members" in sql:
            assert "login_group_members.is_active is true" in sql
            result.all.return_value = [(TEAM, ALICE), (TEAM, BOB), (TEAM, GONE)]
        elif "from login_groups" in sql:
            result.all.return_value = [(TEAM,)] if TEAM.hex in sql else []
        elif "from login_organization_members" in sql:
            result.all.return_value = [(ALICE,), (BOB,)]
        elif "from projects_worklogs" in sql:
            assert "projects_worklogs.is_deleted is false" in sql
            result.all.return_value = [(ALICE, 200), (BOB, 50)]
        elif "from settings_profiles" in sql:
            result.all.return_value = []
        else:
            raise AssertionError(sql)
        return result


def _env(sprint, tasks: list, *, policy: ResolvedTimePolicy | None = None, busy=None):  # noqa: ANN001
    session = _Session(sprint, tasks)
    access = MagicMock()
    access.require_project_view = AsyncMock()
    patches = [
        patch(f"{MODULE}.TimeAccess", return_value=access),
        patch(
            f"{MODULE}.load_time_policy",
            new=AsyncMock(return_value=policy or ResolvedTimePolicy(organization_id=ORG)),
        ),
        patch(f"{CAPACITY}.get_busy_intervals", new=busy or AsyncMock(return_value={})),
    ]
    return session, access, patches


def test_split_estimate_adds_up_exactly() -> None:
    a, b, c = sorted([uuid4(), uuid4(), uuid4()])
    assert split_estimate(100, [c, a, b]) == {a: 34, b: 33, c: 33}
    assert split_estimate(0, [a]) == {}
    assert split_estimate(90, []) == {}


async def test_two_members_lose_a_holiday_and_one_loses_a_day_away() -> None:
    policy = ResolvedTimePolicy(organization_id=ORG, holidays=("2026-10-14",))
    away = BusyInterval(
        datetime(2026, 10, 20, 0, tzinfo=UTC),
        datetime(2026, 10, 21, 0, tzinfo=UTC),
        out_of_office=True,
    )
    tasks = [
        (TASK_SOLO, [str(ALICE)], 600),
        (TASK_TEAM, [str(TEAM)], 300),
        (TASK_BOB, [str(BOB), "not-a-uuid"], 100),
    ]
    session, access, patches = _env(
        _sprint(), tasks, policy=policy, busy=AsyncMock(return_value={ALICE: [away], BOB: []})
    )
    with patches[0], patches[1], patches[2]:
        capacity = await SprintCapacityReader(session).get(ACTOR, ORG, SPRINT)

    access.require_project_view.assert_awaited_once_with(ACTOR, ORG, PROJECT)
    alice, bob = capacity.rows
    assert (alice.user_id, bob.user_id) == (ALICE, BOB) or (alice.user_id, bob.user_id) == (
        BOB,
        ALICE,
    )
    by_user = {row.user_id: row for row in capacity.rows}
    assert by_user[ALICE].capacity_minutes == TWO_WEEKS - HOLIDAY - AWAY_DAY
    assert by_user[BOB].capacity_minutes == TWO_WEEKS - HOLIDAY
    assert by_user[ALICE].estimated_minutes == 600 + 150
    assert by_user[BOB].estimated_minutes == 150 + 100
    assert by_user[ALICE].logged_minutes == 200
    assert by_user[BOB].logged_minutes == 50
    assert capacity.capacity_minutes == 2 * TWO_WEEKS - 2 * HOLIDAY - AWAY_DAY
    assert capacity.estimated_minutes == 1000
    assert capacity.logged_minutes == 250
    assert GONE not in by_user


async def test_a_sprint_without_dates_has_no_capacity() -> None:
    session, _, patches = _env(_sprint(start=None), [(TASK_SOLO, [str(ALICE)], 60)])
    with patches[0], patches[1], patches[2]:
        capacity = await SprintCapacityReader(session).get(ACTOR, ORG, SPRINT)
    assert [row.capacity_minutes for row in capacity.rows] == [0]
    assert capacity.estimated_minutes == 60
    assert not any("from settings_profiles" in sql for sql in session.statements)


async def test_an_empty_sprint_reads_nothing_more() -> None:
    session, _, patches = _env(_sprint(), [])
    with patches[0], patches[1], patches[2]:
        capacity = await SprintCapacityReader(session).get(ACTOR, ORG, SPRINT)
    assert capacity.rows == []
    assert capacity.capacity_minutes == 0
    assert not any("from projects_worklogs" in sql for sql in session.statements)


async def test_an_unknown_sprint_and_a_denied_project_both_refuse() -> None:
    session, access, patches = _env(None, [])
    with patches[0], patches[1], patches[2], pytest.raises(NotFoundError):
        await SprintCapacityReader(session).get(ACTOR, ORG, SPRINT)

    session, access, patches = _env(_sprint(), [])
    access.require_project_view.side_effect = PermissionDeniedError("view")
    with patches[0], patches[1], patches[2], pytest.raises(PermissionDeniedError):
        await SprintCapacityReader(session).get(ACTOR, ORG, SPRINT)
    assert not any("from projects_tasks" in sql for sql in session.statements)


@pytest.mark.parametrize(
    "start,end",
    [
        ("2026-01-01", "2126-01-01"),
        ("0001-01-01", "0001-01-07"),
        ("9999-12-25", "9999-12-31"),
    ],
)
async def test_capacity_rejects_invalid_ranges_before_expansion(start: str, end: str) -> None:
    busy = AsyncMock(return_value={})
    session, _, patches = _env(_sprint(start, end), [], busy=busy)
    with patches[0], patches[1], patches[2], pytest.raises(ValidationError):
        await SprintCapacityReader(session).get(ACTOR, ORG, SPRINT)
    busy.assert_not_awaited()
    assert len(session.statements) == 1
