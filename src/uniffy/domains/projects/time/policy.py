"""Per-org time tracking policy backed by the generic ``org_settings`` KV store.

Stored as one JSON blob under ``namespace='projects'``, ``key='time_policy'``. An
absent row resolves to the coded defaults because every read path needs a value.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date
from enum import StrEnum
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.config.settings.organization import OrgSettingsOperations
from uniffy.core.errors import ValidationError
from uniffy.domains.settings.preferences import WEEK_START_WEEKDAYS

PROJECTS_NAMESPACE = "projects"
TIME_POLICY_KEY = "time_policy"

ALLOWED_ROUNDINGS: tuple[int, ...] = (1, 5, 6, 10, 15)
MINUTES_PER_DAY = 1440
# Every month has this many days, so a monthly period always has a start.
MAX_MONTH_START_DAY = 28
MAX_PERIOD_LOCK_DELAY_DAYS = 30
MAX_TIMER_HOURS = 24
MAX_HOUR_UTC = 23


class PeriodType(StrEnum):
    WEEKLY = "weekly"
    MONTHLY = "monthly"


@dataclass(frozen=True)
class ResolvedTimePolicy:
    """Effective per-org time policy; field names mirror the proto message."""

    organization_id: UUID
    enabled: bool = True
    period_type: PeriodType = PeriodType.WEEKLY
    week_start: str = "monday"
    month_start_day: int = 1
    approvals_enabled: bool = False
    lock_on_submit: bool = True
    period_lock_delay_days: int = 2
    allow_log_for_others: bool = True
    required_minutes_per_day: int = 480
    timer_rounding_minutes: int = 1
    allow_future_dates: bool = False
    max_days_back: int | None = None
    max_timer_hours: int = 12
    auto_submit: bool = False
    holidays: tuple[str, ...] = ()
    internal_project_id: UUID | None = None
    reminders_enabled: bool = False
    reminder_hour_utc: int = 9


def _from_blob(organization_id: UUID, blob: dict[str, Any]) -> ResolvedTimePolicy:
    defaults = ResolvedTimePolicy(organization_id=organization_id)
    max_days_back = blob.get("max_days_back", defaults.max_days_back)
    internal_project_id = blob.get("internal_project_id")
    return replace(
        defaults,
        enabled=bool(blob.get("enabled", defaults.enabled)),
        period_type=PeriodType(blob.get("period_type", defaults.period_type)),
        week_start=str(blob.get("week_start", defaults.week_start)),
        month_start_day=int(blob.get("month_start_day", defaults.month_start_day)),
        approvals_enabled=bool(blob.get("approvals_enabled", defaults.approvals_enabled)),
        lock_on_submit=bool(blob.get("lock_on_submit", defaults.lock_on_submit)),
        period_lock_delay_days=int(
            blob.get("period_lock_delay_days", defaults.period_lock_delay_days)
        ),
        allow_log_for_others=bool(blob.get("allow_log_for_others", defaults.allow_log_for_others)),
        required_minutes_per_day=int(
            blob.get("required_minutes_per_day", defaults.required_minutes_per_day)
        ),
        timer_rounding_minutes=int(
            blob.get("timer_rounding_minutes", defaults.timer_rounding_minutes)
        ),
        allow_future_dates=bool(blob.get("allow_future_dates", defaults.allow_future_dates)),
        max_days_back=None if max_days_back is None else int(max_days_back),
        max_timer_hours=int(blob.get("max_timer_hours", defaults.max_timer_hours)),
        auto_submit=bool(blob.get("auto_submit", defaults.auto_submit)),
        holidays=tuple(str(day) for day in blob.get("holidays", ())),
        internal_project_id=UUID(str(internal_project_id)) if internal_project_id else None,
        reminders_enabled=bool(blob.get("reminders_enabled", defaults.reminders_enabled)),
        reminder_hour_utc=int(blob.get("reminder_hour_utc", defaults.reminder_hour_utc)),
    )


def _to_blob(policy: ResolvedTimePolicy) -> dict[str, Any]:
    return {
        "enabled": policy.enabled,
        "period_type": policy.period_type.value,
        "week_start": policy.week_start,
        "month_start_day": policy.month_start_day,
        "approvals_enabled": policy.approvals_enabled,
        "lock_on_submit": policy.lock_on_submit,
        "period_lock_delay_days": policy.period_lock_delay_days,
        "allow_log_for_others": policy.allow_log_for_others,
        "required_minutes_per_day": policy.required_minutes_per_day,
        "timer_rounding_minutes": policy.timer_rounding_minutes,
        "allow_future_dates": policy.allow_future_dates,
        "max_days_back": policy.max_days_back,
        "max_timer_hours": policy.max_timer_hours,
        "auto_submit": policy.auto_submit,
        "holidays": sorted(set(policy.holidays)),
        "internal_project_id": (
            str(policy.internal_project_id) if policy.internal_project_id else None
        ),
        "reminders_enabled": policy.reminders_enabled,
        "reminder_hour_utc": policy.reminder_hour_utc,
    }


def require_enabled(policy: ResolvedTimePolicy) -> None:
    if not policy.enabled:
        raise ValidationError("time_tracking", "time tracking is turned off for this organization")


def _require_range(field: str, value: int, low: int, high: int) -> None:
    if not low <= value <= high:
        raise ValidationError(field, f"must be between {low} and {high}")


def validate_time_policy(policy: ResolvedTimePolicy) -> None:
    if policy.week_start not in WEEK_START_WEEKDAYS:
        raise ValidationError("week_start", "must be monday, saturday or sunday")
    _require_range("month_start_day", policy.month_start_day, 1, MAX_MONTH_START_DAY)
    _require_range(
        "period_lock_delay_days", policy.period_lock_delay_days, 0, MAX_PERIOD_LOCK_DELAY_DAYS
    )
    _require_range("required_minutes_per_day", policy.required_minutes_per_day, 0, MINUTES_PER_DAY)
    if policy.timer_rounding_minutes not in ALLOWED_ROUNDINGS:
        raise ValidationError(
            "timer_rounding_minutes", f"must be one of {', '.join(map(str, ALLOWED_ROUNDINGS))}"
        )
    if policy.max_days_back is not None and policy.max_days_back < 0:
        raise ValidationError("max_days_back", "must be zero or more")
    _require_range("max_timer_hours", policy.max_timer_hours, 1, MAX_TIMER_HOURS)
    _require_range("reminder_hour_utc", policy.reminder_hour_utc, 0, MAX_HOUR_UTC)
    for holiday in policy.holidays:
        try:
            date.fromisoformat(holiday)
        except ValueError as exc:
            raise ValidationError("holidays", f"{holiday!r} is not a YYYY-MM-DD date") from exc


async def load_time_policy(session: AsyncSession, organization_id: UUID) -> ResolvedTimePolicy:
    """The org's stored policy, or the coded defaults when no row exists."""
    rows = await OrgSettingsOperations(session).get_namespace(organization_id, PROJECTS_NAMESPACE)
    row = rows.get(TIME_POLICY_KEY)
    if row is None or not isinstance(row.value, dict):
        return ResolvedTimePolicy(organization_id=organization_id)
    return _from_blob(organization_id, row.value)


async def save_time_policy(
    session: AsyncSession,
    *,
    policy: ResolvedTimePolicy,
    updated_by_user_id: UUID,
) -> None:
    """Validate and upsert the org's policy blob (caller commits)."""
    validate_time_policy(policy)
    await OrgSettingsOperations(session).set(
        organization_id=policy.organization_id,
        namespace=PROJECTS_NAMESPACE,
        key=TIME_POLICY_KEY,
        value=_to_blob(policy),
        updated_by_user_id=updated_by_user_id,
    )
