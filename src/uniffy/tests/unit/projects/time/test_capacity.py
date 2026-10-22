from datetime import date
from unittest.mock import MagicMock
from uuid import uuid4

from uniffy.domains.projects.time.capacity import (
    required_minutes_between,
    required_minutes_on,
    workdays_for_users,
)
from uniffy.domains.projects.time.policy import ResolvedTimePolicy
from uniffy.domains.settings.defaults import SCHEDULING_DEFAULTS

ORG = uuid4()
WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday")


def test_required_minutes_skip_holidays_and_days_off() -> None:
    policy = ResolvedTimePolicy(organization_id=ORG, holidays=("2026-10-14",))
    assert required_minutes_on(date(2026, 10, 13), policy, WEEKDAYS) == 480
    assert required_minutes_on(date(2026, 10, 14), policy, WEEKDAYS) == 0
    assert required_minutes_on(date(2026, 10, 17), policy, WEEKDAYS) == 0
    assert required_minutes_on(date(2026, 10, 17), policy, ("saturday",)) == 480
    assert required_minutes_between(date(2026, 10, 12), date(2026, 10, 18), policy, WEEKDAYS) == 1920


async def test_workdays_for_users_falls_back_to_the_scheduling_default() -> None:
    configured, plain = uuid4(), uuid4()
    session = MagicMock()
    result = MagicMock()
    result.all.return_value = [(configured, {"workdays": ["monday", "tuesday"]}), (plain, {})]

    async def execute(stmt):  # noqa: ANN001, ANN202
        sql = str(stmt.compile(compile_kwargs={"literal_binds": True})).lower()
        assert "settings_profiles.is_default is true" in sql
        return result

    session.execute = execute
    workdays = await workdays_for_users(session, [configured, plain])
    assert workdays[configured] == ("monday", "tuesday")
    assert workdays[plain] == SCHEDULING_DEFAULTS.workdays
    assert await workdays_for_users(session, []) == {}
