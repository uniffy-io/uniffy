from contextlib import ExitStack
from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from uniffy.core.errors import ValidationError
from uniffy.core.models.projects.timesheet import TimePeriod, Timesheet, TimesheetStatus
from uniffy.domains.projects.time.capacity import DayRequirement, days_between, required_minutes_on
from uniffy.domains.projects.time.closures import PeriodView
from uniffy.domains.projects.time.policy import ResolvedTimePolicy
from uniffy.domains.projects.time.review import MAX_PAGE_SIZE, TimesheetReview
from uniffy.core.models.projects.timesheet import TimePeriodStatus

ORG = uuid4()
ACTOR = uuid4()
ALICE = uuid4()
BOB = uuid4()
MODULE = "uniffy.domains.projects.time.review"
PERIOD_START = date(2026, 10, 12)


WORKDAYS = {ALICE: ("monday", "tuesday"), BOB: ("monday",)}


async def _requirements(session, organization_id, user_ids, start, end, policy):  # noqa: ANN001
    return {
        user_id: [
            DayRequirement(
                day=day,
                required_minutes=required_minutes_on(day, policy, WORKDAYS.get(user_id, ())),
                off=False,
            )
            for day in days_between(start, end)
        ]
        for user_id in user_ids
    }


def _compiled(stmt) -> str:  # noqa: ANN001
    return str(stmt.compile(compile_kwargs={"literal_binds": True})).lower()


class _Session:
    def __init__(self, people: list, sheets: list, totals: list) -> None:
        self.people = people
        self.sheets = sheets
        self.totals = totals
        self.statements: list = []

    async def execute(self, stmt):  # noqa: ANN001
        self.statements.append(stmt)
        sql = _compiled(stmt)
        result = MagicMock()
        if "from login_organization_members join login_users" in sql.replace("\n", " "):
            result.all.return_value = self.people
        elif "from projects_timesheets" in sql:
            result.scalars.return_value.all.return_value = self.sheets
        elif "sum(projects_worklogs.duration_minutes)" in sql:
            result.all.return_value = self.totals
        else:
            result.all.return_value = []
        return result


def _env(*, admin: bool, people: list, sheets: list | None = None, totals: list | None = None):  # noqa: ANN202
    stack = ExitStack()
    session = _Session(people, sheets or [], totals or [])
    access = MagicMock()
    access.require_active_actor = AsyncMock()
    access.is_timekeeping_admin = AsyncMock(return_value=admin)
    stack.enter_context(patch(f"{MODULE}.TimeAccess", return_value=access))
    stack.enter_context(
        patch(
            f"{MODULE}.load_time_policy",
            new=AsyncMock(
                return_value=ResolvedTimePolicy(organization_id=ORG, approvals_enabled=True)
            ),
        )
    )
    periods = MagicMock()
    periods.list = AsyncMock(
        return_value=[
            PeriodView(
                period=None,
                start_date=PERIOD_START,
                end_date=date(2026, 10, 18),
                status=TimePeriodStatus.OPEN,
            )
        ]
    )
    stack.enter_context(patch(f"{MODULE}.PeriodOperations", return_value=periods))
    stack.enter_context(
        patch(
            f"{MODULE}.day_requirements_for",
            new=AsyncMock(side_effect=_requirements),
        )
    )
    return stack, session, TimesheetReview(session)  # type: ignore[arg-type]


async def test_the_people_query_scopes_to_active_members_the_actor_reviews() -> None:
    stack, session, review = _env(admin=False, people=[])
    with stack:
        page = await review.list_for_reviewer(ACTOR, ORG, date(2026, 10, 15))
    sql = _compiled(session.statements[0]).replace("\n", " ")
    assert f"login_organization_members.organization_id = '{ORG.hex}'" in sql
    assert "login_organization_members.is_active is true" in sql
    assert "login_users.is_active is true" in sql
    assert f"login_users.id != '{ACTOR.hex}'" in sql
    assert f"people_profiles.manager_user_id = '{ACTOR.hex}'" in sql
    assert f"login_groups.lead_user_id = '{ACTOR.hex}'" in sql
    assert "people_profiles.manager_user_id is not null" not in sql
    assert "limit 51" in sql
    assert page.rows == [] and page.next_page_token == ""
    assert page.viewer_is_timekeeping_admin is False
    assert len(session.statements) == 1


async def test_an_admin_also_sees_people_with_no_active_reviewer() -> None:
    stack, session, review = _env(admin=True, people=[])
    with stack:
        await review.list_for_reviewer(ACTOR, ORG, PERIOD_START)
    sql = _compiled(session.statements[0]).replace("\n", " ")
    assert "not (" in sql
    assert "people_profiles.manager_user_id is not null" in sql
    assert "people_profiles.manager_user_id != login_users.id" in sql
    assert "login_groups.lead_user_id != login_users.id" in sql


async def test_filters_land_in_the_query_and_the_page_size_is_capped() -> None:
    stack, session, review = _env(admin=False, people=[])
    team = uuid4()
    with stack:
        await review.list_for_reviewer(
            ACTOR,
            ORG,
            PERIOD_START,
            status=TimesheetStatus.SUBMITTED,
            query="ali",
            team_id=team,
            page_size=10_000,
            page_token="40",
        )
    sql = _compiled(session.statements[0]).replace("\n", " ")
    assert "'%ali%'" in sql
    assert f"login_group_members.group_id = '{team.hex}'" in sql
    assert "'open') = 'submitted'" in sql
    assert f"limit {MAX_PAGE_SIZE + 1}" in sql
    assert "offset 40" in sql


async def test_hydration_builds_day_meters_totals_and_lock_state_per_person() -> None:
    sheet = Timesheet(
        id=uuid4(),
        organization_id=ORG,
        user_id=ALICE,
        period_start=PERIOD_START,
        period_end=date(2026, 10, 18),
        status=TimesheetStatus.SUBMITTED,
    )
    stack, session, review = _env(
        admin=False,
        people=[(ALICE, "submitted"), (BOB, "open")],
        sheets=[sheet],
        totals=[
            (ALICE, date(2026, 10, 12), 480),
            (ALICE, date(2026, 10, 13), 120),
            (BOB, date(2026, 10, 12), 60),
        ],
    )
    with stack:
        page = await review.list_for_reviewer(ACTOR, ORG, PERIOD_START, page_size=50)
    alice, bob = page.rows
    assert alice.sheet.status == TimesheetStatus.SUBMITTED
    assert alice.sheet.locked is True
    assert alice.sheet.total_minutes == 600
    assert alice.sheet.required_minutes == 960
    assert [total.minutes for total in alice.days] == [480, 120, 0, 0, 0, 0, 0]
    assert [total.required_minutes for total in alice.days] == [480, 480, 0, 0, 0, 0, 0]
    assert bob.sheet.timesheet is None
    assert bob.sheet.status == TimesheetStatus.OPEN
    assert bob.sheet.total_minutes == 60
    assert bob.sheet.required_minutes == 480
    assert len(session.statements) == 3


async def test_a_closed_period_row_locks_every_sheet_even_as_a_plain_string() -> None:
    stack, session, review = _env(admin=True, people=[(BOB, "open")])
    with stack:
        periods = MagicMock()
        periods.list = AsyncMock(
            return_value=[
                PeriodView(
                    period=TimePeriod(
                        organization_id=ORG,
                        start_date=PERIOD_START,
                        end_date=date(2026, 10, 18),
                        status="closed",  # type: ignore[arg-type] - what the row store hands back
                    ),
                    start_date=PERIOD_START,
                    end_date=date(2026, 10, 18),
                    status="closed",  # type: ignore[arg-type]
                )
            ]
        )
        stack.enter_context(patch(f"{MODULE}.PeriodOperations", return_value=periods))
        page = await review.list_for_reviewer(ACTOR, ORG, PERIOD_START)
    (bob,) = page.rows
    assert bob.sheet.period_closed is True
    assert bob.sheet.locked is True


async def test_a_bad_page_token_is_rejected() -> None:
    stack, _, review = _env(admin=False, people=[])
    with stack, pytest.raises(ValidationError, match="page token"):
        await review.list_for_reviewer(ACTOR, ORG, PERIOD_START, page_token="x")
