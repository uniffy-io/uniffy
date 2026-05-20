"""Image-generation quota check.

Used by ``tools/builtin/images.py`` to gate new image generations
against the per-user daily cap and the per-organization monthly cap.
Rate limiting (``core/valkey/rate_limit.py``) is independent: it
governs burst within seconds/minutes, while the quota governs counts
per day/month. Both checks run, and either one can trip.

Enforcement rules:

- A request is **hard-rejected** when ``(user_quota OR agent_budget).hard_limit``
  is true on the row supplying the governing cap.
- Otherwise a soft overage logs a warning and lets the request through.
- Absent rows on either side fall back to
  ``DEFAULT_DAILY_IMAGE_LIMIT_PER_USER`` and
  ``DEFAULT_MONTHLY_IMAGE_LIMIT_PER_ORG`` from ``defaults.py``. When the
  cap comes from a default the quota is always treated as soft - we
  never hard-reject unless an admin has explicitly opted in by writing
  a row.
"""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import BudgetExceededError
from uniffy.core.models.agents.budget import AgentBudget
from uniffy.core.models.agents.run_log import AgentRunLog
from uniffy.core.models.agents.user_quota import AgentUserQuota
from uniffy.domains.agents.budgets.defaults import (
    DEFAULT_DAILY_IMAGE_LIMIT_PER_USER,
    DEFAULT_MONTHLY_IMAGE_LIMIT_PER_ORG,
)
from uniffy.domains.agents.budgets.period import month_window


async def _count_images_today_for_user(
    session: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
    now: datetime,
) -> int:
    """Count image-generation runs for this user in the current UTC day."""
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    result = await session.execute(
        select(func.coalesce(func.sum(AgentRunLog.image_count), 0)).where(
            AgentRunLog.user_id == user_id,
            AgentRunLog.organization_id == organization_id,
            AgentRunLog.kind == "image",
            AgentRunLog.created_at >= day_start,
        )
    )
    return int(result.scalar() or 0)


async def _count_images_this_month_for_org(
    session: AsyncSession,
    *,
    organization_id: UUID,
    period_start: datetime,
    period_end: datetime,
) -> int:
    """Count image-generation runs across the org within the current period."""
    result = await session.execute(
        select(func.coalesce(func.sum(AgentRunLog.image_count), 0)).where(
            AgentRunLog.organization_id == organization_id,
            AgentRunLog.kind == "image",
            AgentRunLog.created_at >= period_start,
            AgentRunLog.created_at < period_end,
        )
    )
    return int(result.scalar() or 0)


async def check_image_quota(
    session: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
    now: datetime | None = None,
) -> None:
    """Check daily-per-user and monthly-per-org image caps.

    Raises ``BudgetExceededError`` when the governing row has
    ``hard_limit=True`` and the current-period count is already at or
    above the cap. Otherwise logs a warning on overage and returns.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    user_id : UUID
        The human user invoking ``images.generate_image``.
    organization_id : UUID
        Organization scope.
    now : datetime | None
        Injected clock for tests; defaults to UTC now.

    """
    now = now or datetime.now(UTC)

    quota_result = await session.execute(
        select(AgentUserQuota).where(
            AgentUserQuota.organization_id == organization_id,
            AgentUserQuota.user_id == user_id,
        )
    )
    quota = quota_result.scalar_one_or_none()

    budget_result = await session.execute(
        select(AgentBudget).where(AgentBudget.organization_id == organization_id)
    )
    budget = budget_result.scalar_one_or_none()

    daily_cap_from_row = quota.daily_image_limit if quota else None
    daily_cap = (
        daily_cap_from_row
        if daily_cap_from_row is not None
        else DEFAULT_DAILY_IMAGE_LIMIT_PER_USER
    )
    # Only a row-backed cap can trigger hard enforcement; a default is
    # always soft because no admin has explicitly opted in.
    daily_hard = bool(
        quota is not None
        and quota.hard_limit
        and daily_cap_from_row is not None
    )

    daily_count = await _count_images_today_for_user(
        session,
        user_id=user_id,
        organization_id=organization_id,
        now=now,
    )
    if daily_count >= daily_cap:
        if daily_hard:
            raise BudgetExceededError(
                scope="user",
                limit_kind="image_count",
                current=str(daily_count),
                limit=str(daily_cap),
            )
        logger.warning(
            "Soft image quota overage (user/day)",
            user_id=str(user_id),
            organization_id=str(organization_id),
            current=daily_count,
            cap=daily_cap,
            default=daily_cap_from_row is None,
        )

    monthly_cap_from_budget = budget.image_monthly_limit if budget else None
    monthly_cap = (
        monthly_cap_from_budget
        if monthly_cap_from_budget is not None
        else DEFAULT_MONTHLY_IMAGE_LIMIT_PER_ORG
    )
    monthly_hard = bool(
        budget is not None
        and budget.hard_limit
        and monthly_cap_from_budget is not None
    )

    reset_day = budget.reset_day if budget else 1
    period_start, period_end = month_window(reset_day, now)
    monthly_count = await _count_images_this_month_for_org(
        session,
        organization_id=organization_id,
        period_start=period_start,
        period_end=period_end,
    )
    if monthly_count >= monthly_cap:
        if monthly_hard:
            raise BudgetExceededError(
                scope="org",
                limit_kind="image_count",
                current=str(monthly_count),
                limit=str(monthly_cap),
            )
        logger.warning(
            "Soft image quota overage (org/month)",
            organization_id=str(organization_id),
            current=monthly_count,
            cap=monthly_cap,
            default=monthly_cap_from_budget is None,
        )
