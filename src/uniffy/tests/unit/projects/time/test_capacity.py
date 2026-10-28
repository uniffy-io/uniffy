from datetime import UTC, date, datetime, time, timedelta
from fractions import Fraction
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from uniffy.domains.projects.time.capacity import (
    HALF_OFF,
    OFF,
    PersonSchedule,
    day_requirements_for,
    days_between,
    off_days_for,
    off_fraction,
    required_minutes_between,
    required_minutes_on,
    schedules_for_users,
)
from uniffy.domains.projects.time.policy import ResolvedTimePolicy
from uniffy.domains.scheduling.calendar.availability import (
    MAX_FREE_BUSY_USERS,
    MAX_WINDOW_DAYS,
    BusyInterval,
)
from uniffy.domains.settings.defaults import SCHEDULING_DEFAULTS

MODULE = "uniffy.domains.projects.time.capacity"
ORG = uuid4()
WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday")
MONDAY = date(2026, 10, 12)
SUNDAY = date(2026, 10, 18)
FULL_DAY = 480
HALF_DAY = 240
WEEK = 2400


def _utc(day: date, hour: int, minute: int = 0) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=UTC)


def _away(start: datetime, end: datetime) -> BusyInterval:
    return BusyInterval(start, end, out_of_office=True)


class _Session:
    """Answers the active-member and settings-profile reads; everything else is patched."""

    def __init__(self, active: list, profiles: list | None = None) -> None:
        self.active = active
        self.profiles = profiles or []
        self.statements: list[str] = []

    async def execute(self, stmt):  # noqa: ANN001
        sql = str(stmt.compile(compile_kwargs={"literal_binds": True})).lower()
        self.statements.append(sql)
        result = MagicMock()
        if "from settings_profiles" in sql:
            result.all.return_value = self.profiles
        else:
            assert "login_organization_members.is_active is true" in sql
            assert "login_users.is_active is true" in sql
            result.all.return_value = [(user_id,) for user_id in self.active]
        return result


def test_required_minutes_skip_holidays_and_days_off() -> None:
    policy = ResolvedTimePolicy(organization_id=ORG, holidays=("2026-10-14",))
    assert required_minutes_on(date(2026, 10, 13), policy, WEEKDAYS) == FULL_DAY
    assert required_minutes_on(date(2026, 10, 14), policy, WEEKDAYS) == 0
    assert required_minutes_on(date(2026, 10, 17), policy, WEEKDAYS) == 0
    assert required_minutes_on(date(2026, 10, 17), policy, ("saturday",)) == FULL_DAY
    assert required_minutes_between(MONDAY, SUNDAY, policy, WEEKDAYS) == 4 * FULL_DAY


def test_days_off_scale_the_requirement() -> None:
    policy = ResolvedTimePolicy(organization_id=ORG)
    assert required_minutes_on(MONDAY, policy, WEEKDAYS, HALF_OFF) == HALF_DAY
    assert required_minutes_on(MONDAY, policy, WEEKDAYS, OFF) == 0
    off = {MONDAY: OFF, date(2026, 10, 13): HALF_OFF}
    assert (
        required_minutes_between(MONDAY, SUNDAY, policy, WEEKDAYS, off) == WEEK - FULL_DAY - HALF_DAY
    )
    assert days_between(MONDAY, MONDAY) == [MONDAY]
    assert len(days_between(MONDAY, SUNDAY)) == 7


def test_a_whole_day_away_is_off_and_half_the_window_is_a_half_day() -> None:
    schedule = PersonSchedule()
    day = date(2026, 10, 13)
    assert (
        off_fraction(day, [_away(_utc(day, 0), _utc(day + timedelta(days=1), 0))], schedule) == OFF
    )
    assert off_fraction(day, [_away(_utc(day, 9), _utc(day, 18))], schedule) == OFF
    assert off_fraction(day, [_away(_utc(day, 9), _utc(day, 13, 30))], schedule) == HALF_OFF
    assert off_fraction(day, [_away(_utc(day, 9), _utc(day, 13))], schedule) == Fraction(0)
    assert (
        off_fraction(
            day, [_away(_utc(day, 7), _utc(day, 12)), _away(_utc(day, 15), _utc(day, 18))], schedule
        )
        == HALF_OFF
    )
    assert off_fraction(day, [], schedule) == Fraction(0)


def test_the_day_boundary_is_the_persons_own_clock() -> None:
    day = date(2026, 10, 13)
    utc_day = [_away(_utc(day, 0), _utc(day + timedelta(days=1), 0))]
    # NZDT is UTC+13: the UTC day runs 13:00 to 13:00 locally, half of a nine hour window.
    auckland = PersonSchedule(timezone="Pacific/Auckland")
    assert off_fraction(day, utc_day, auckland) == HALF_OFF
    assert off_fraction(day + timedelta(days=1), utc_day, auckland) == Fraction(0)
    assert off_fraction(day, utc_day, PersonSchedule(timezone="UTC")) == OFF
    evening = PersonSchedule(
        workday_start=time(16, 0), workday_end=time(22, 0), timezone="Pacific/Auckland"
    )
    assert off_fraction(day, utc_day, evening) == OFF


async def test_off_days_combine_holidays_with_recurring_absences() -> None:
    worker, other = uuid4(), uuid4()
    policy = ResolvedTimePolicy(organization_id=ORG, holidays=("2026-10-12", "2026-12-25"))
    wednesday, next_wednesday = date(2026, 10, 14), date(2026, 10, 21)
    busy = AsyncMock(
        return_value={
            worker: [
                _away(_utc(wednesday, 9), _utc(wednesday, 18)),
                _away(_utc(next_wednesday, 9), _utc(next_wednesday, 18)),
                _away(_utc(date(2026, 10, 15), 9), _utc(date(2026, 10, 15), 14)),
            ],
            other: [],
        }
    )
    session = _Session(active=[worker, other])
    with patch(f"{MODULE}.get_busy_intervals", busy):
        off = await off_days_for(
            session,
            ORG,
            [worker, other],
            MONDAY,
            date(2026, 10, 25),
            policy,
            {worker: PersonSchedule(), other: PersonSchedule()},
        )
    assert off[worker] == {
        MONDAY: OFF,
        wednesday: OFF,
        next_wednesday: OFF,
        date(2026, 10, 15): HALF_OFF,
    }
    assert off[other] == {MONDAY: OFF}
    args = busy.await_args.args
    assert args[2] == [worker, other]
    assert args[3] == _utc(MONDAY, 0) - timedelta(days=1)
    assert args[4] == _utc(date(2026, 10, 26), 0) + timedelta(days=1)


async def test_free_busy_reads_are_chunked_by_users_and_windows() -> None:
    users = [uuid4() for _ in range(MAX_FREE_BUSY_USERS + 1)]
    policy = ResolvedTimePolicy(organization_id=ORG)
    busy = AsyncMock(return_value={})
    with patch(f"{MODULE}.get_busy_intervals", busy):
        off = await off_days_for(
            _Session(active=users), ORG, users, MONDAY, MONDAY + timedelta(days=99), policy, {}
        )
    assert all(off[user] == {} for user in users)
    assert busy.await_count == 4
    for call in busy.await_args_list:
        _, _, chunk, start, end = call.args
        assert len(chunk) <= MAX_FREE_BUSY_USERS
        assert end - start <= timedelta(days=MAX_WINDOW_DAYS)


async def test_inactive_people_only_get_holidays() -> None:
    gone = uuid4()
    policy = ResolvedTimePolicy(organization_id=ORG, holidays=("2026-10-13",))
    busy = AsyncMock()
    with patch(f"{MODULE}.get_busy_intervals", busy):
        off = await off_days_for(_Session(active=[]), ORG, [gone], MONDAY, SUNDAY, policy, {})
    assert off == {gone: {date(2026, 10, 13): OFF}}
    busy.assert_not_awaited()


async def test_schedules_fall_back_to_the_defaults_field_by_field() -> None:
    configured, plain, broken = uuid4(), uuid4(), uuid4()
    session = _Session(
        active=[],
        profiles=[
            (
                configured,
                {
                    "workdays": ["monday", "tuesday"],
                    "workday_start": "08:00",
                    "workday_end": "16:30",
                },
                {"timezone": "Europe/Sofia"},
            ),
            (plain, {}, None),
            (broken, {"workdays": [], "workday_start": "late"}, {"timezone": "Mars/Olympus"}),
        ],
    )
    schedules = await schedules_for_users(session, [configured, plain, broken])
    assert schedules[configured] == PersonSchedule(
        workdays=("monday", "tuesday"),
        workday_start=time(8, 0),
        workday_end=time(16, 30),
        timezone="Europe/Sofia",
    )
    assert schedules[plain] == PersonSchedule()
    assert schedules[broken] == PersonSchedule()
    assert schedules[plain].workdays == SCHEDULING_DEFAULTS.workdays
    assert "settings_profiles.is_default is true" in session.statements[0]
    assert await schedules_for_users(session, []) == {}


async def test_day_requirements_carry_the_off_flag() -> None:
    worker = uuid4()
    policy = ResolvedTimePolicy(organization_id=ORG, holidays=("2026-10-16",))
    tuesday = date(2026, 10, 13)
    busy = AsyncMock(return_value={worker: [_away(_utc(tuesday, 9), _utc(tuesday, 14))]})
    with patch(f"{MODULE}.get_busy_intervals", busy):
        requirements = await day_requirements_for(
            _Session(active=[worker]), ORG, [worker], MONDAY, SUNDAY, policy
        )
    rows = requirements[worker]
    assert [row.day for row in rows] == days_between(MONDAY, SUNDAY)
    assert [row.required_minutes for row in rows] == [
        FULL_DAY,
        HALF_DAY,
        FULL_DAY,
        FULL_DAY,
        0,
        0,
        0,
    ]
    assert [row.off for row in rows] == [False, True, False, False, True, False, False]
