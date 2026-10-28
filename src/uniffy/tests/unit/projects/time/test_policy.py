from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from uniffy.core.errors import ValidationError
from uniffy.domains.projects.time.policy import (
    PROJECTS_NAMESPACE,
    TIME_POLICY_KEY,
    PeriodType,
    ResolvedTimePolicy,
    _from_blob,
    _to_blob,
    load_time_policy,
    save_time_policy,
    validate_time_policy,
)

ORG = uuid4()


def _settings(rows: dict) -> MagicMock:
    ops = MagicMock()
    ops.get_namespace = AsyncMock(return_value=rows)
    ops.set = AsyncMock()
    return ops


async def test_load_returns_defaults_when_no_row() -> None:
    with patch(
        "uniffy.domains.projects.time.policy.OrgSettingsOperations", return_value=_settings({})
    ):
        policy = await load_time_policy(AsyncMock(), ORG)

    assert policy == ResolvedTimePolicy(organization_id=ORG)
    assert policy.enabled is True
    assert policy.approvals_enabled is False
    assert policy.period_lock_delay_days == 2


async def test_load_reads_stored_blob() -> None:
    project_id = uuid4()
    row = SimpleNamespace(
        key=TIME_POLICY_KEY,
        value={
            "enabled": False,
            "period_type": "monthly",
            "month_start_day": 15,
            "approvals_enabled": True,
            "timer_rounding_minutes": 5,
            "max_days_back": 30,
            "holidays": ["2026-12-25"],
            "internal_project_id": str(project_id),
        },
    )
    with patch(
        "uniffy.domains.projects.time.policy.OrgSettingsOperations",
        return_value=_settings({TIME_POLICY_KEY: row}),
    ):
        policy = await load_time_policy(AsyncMock(), ORG)

    assert policy.enabled is False
    assert policy.period_type is PeriodType.MONTHLY
    assert policy.month_start_day == 15
    assert policy.approvals_enabled is True
    assert policy.timer_rounding_minutes == 5
    assert policy.max_days_back == 30
    assert policy.holidays == ("2026-12-25",)
    assert policy.internal_project_id == project_id
    # Untouched keys keep their defaults.
    assert policy.required_minutes_per_day == 480


def test_blob_round_trip_preserves_every_field() -> None:
    policy = ResolvedTimePolicy(
        organization_id=ORG,
        enabled=False,
        period_type=PeriodType.MONTHLY,
        week_start="sunday",
        month_start_day=10,
        approvals_enabled=True,
        lock_on_submit=False,
        period_lock_delay_days=5,
        allow_log_for_others=False,
        required_minutes_per_day=420,
        timer_rounding_minutes=15,
        allow_future_dates=True,
        max_days_back=14,
        max_timer_hours=8,
        auto_submit=True,
        holidays=("2026-05-01", "2026-01-01"),
        internal_project_id=uuid4(),
        reminders_enabled=True,
        reminder_hour_utc=7,
    )

    restored = _from_blob(ORG, _to_blob(policy))

    # Holidays are stored sorted and deduplicated; everything else is identical.
    assert restored == ResolvedTimePolicy(**{
        **policy.__dict__,
        "holidays": ("2026-01-01", "2026-05-01"),
    })


async def test_save_validates_then_writes_the_projects_namespace() -> None:
    settings = _settings({})
    actor = uuid4()
    policy = ResolvedTimePolicy(organization_id=ORG, holidays=("2026-03-03", "2026-01-01"))

    with patch("uniffy.domains.projects.time.policy.OrgSettingsOperations", return_value=settings):
        await save_time_policy(AsyncMock(), policy=policy, updated_by_user_id=actor)

    kwargs = settings.set.await_args.kwargs
    assert kwargs["organization_id"] == ORG
    assert kwargs["namespace"] == PROJECTS_NAMESPACE
    assert kwargs["key"] == TIME_POLICY_KEY
    assert kwargs["updated_by_user_id"] == actor
    assert kwargs["value"]["holidays"] == ["2026-01-01", "2026-03-03"]
    assert kwargs["value"]["internal_project_id"] is None


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("week_start", "friday"),
        ("month_start_day", 0),
        ("month_start_day", 29),
        ("period_lock_delay_days", -1),
        ("period_lock_delay_days", 31),
        ("required_minutes_per_day", 1441),
        ("timer_rounding_minutes", 7),
        ("max_days_back", -1),
        ("max_timer_hours", 0),
        ("max_timer_hours", 25),
        ("reminder_hour_utc", 24),
        ("holidays", ("2026-13-01",)),
        ("holidays", ("yesterday",)),
    ],
)
def test_validation_rejects_out_of_range_values(field: str, value: object) -> None:
    policy = ResolvedTimePolicy(organization_id=ORG, **{field: value})

    with pytest.raises(ValidationError) as exc_info:
        validate_time_policy(policy)

    assert exc_info.value.field == field


async def test_save_refuses_an_invalid_policy_before_touching_the_store() -> None:
    settings = _settings({})
    policy = ResolvedTimePolicy(organization_id=ORG, timer_rounding_minutes=2)

    with (
        patch("uniffy.domains.projects.time.policy.OrgSettingsOperations", return_value=settings),
        pytest.raises(ValidationError),
    ):
        await save_time_policy(AsyncMock(), policy=policy, updated_by_user_id=uuid4())

    settings.set.assert_not_awaited()


def test_defaults_pass_validation() -> None:
    validate_time_policy(ResolvedTimePolicy(organization_id=ORG))
