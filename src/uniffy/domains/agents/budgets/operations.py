"""Budget + user-quota CRUD and spend aggregation.

Reads return governing rows along with effective period boundaries.
Writes audit every mutation (``budget.update`` / ``budget.delete`` /
``user_quota.update`` / ``user_quota.delete``) and are org-admin gated.

``check_preflight`` runs inside ``RuntimeOperations.send_message`` /
``stream_send_message`` right after the rate-limit check. It is the
single authoritative entry point for dollar-spend enforcement: hard
overages raise ``BudgetExceededError`` and soft overages log a warning
without blocking the request.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from uuid import UUID

from loguru import logger
from sqlalchemy import Numeric, and_, case, func, select
from sqlalchemy import literal as sa_literal
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import (
    BudgetExceededError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from uniffy.core.models.agents.budget import AgentBudget
from uniffy.core.models.agents.currency_rate import AgentCurrencyRate
from uniffy.core.models.agents.run_log import AgentRunLog
from uniffy.core.models.agents.user_quota import AgentUserQuota
from uniffy.domains.agents.audit import create_audit_log
from uniffy.domains.agents.budgets.period import day_window, month_window
from uniffy.domains.agents.currency import get_display_currency
from uniffy.domains.organizations.operations import OrganizationOperations


@dataclass(frozen=True)
class _PreflightSpend:
    """Internal: the three spend values resolved in one preflight query."""

    user_day: Decimal
    user_month: Decimal
    org_month: Decimal


@dataclass
class SpendSummary:
    """Shape returned by ``get_current_spend`` (proto transport object)."""

    organization_id: UUID
    period_start: datetime
    period_end: datetime
    spend: Decimal
    image_count: int
    pct_of_limit: int | None
    currency: str
    user_id: UUID | None = None


def _parse_decimal(value: str | None, field: str) -> Decimal | None:
    """Parse an optional decimal string or raise ``ValidationError``."""
    if value is None or value == "":
        return None
    try:
        return Decimal(value)
    except (InvalidOperation, TypeError) as exc:
        raise ValidationError(field, f"Invalid decimal value: {value}") from exc


def _validate_reset_day(value: int) -> int:
    if value < 1 or value > 31:
        raise ValidationError("reset_day", "reset_day must be between 1 and 31")
    return value


def _validate_thresholds(values: list[int]) -> list[int]:
    for v in values:
        if v < 1 or v >= 100:
            raise ValidationError(
                "alert_thresholds",
                f"Threshold {v} must be in [1, 100)",
            )
    return sorted(set(values))


class BudgetsOperations:
    """CRUD + spend aggregation for ``agents_budgets`` and ``agents_user_quotas``."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._org_ops = OrganizationOperations(session)

    async def get_org_budget(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
    ) -> AgentBudget | None:
        """Return the organization's budget row, or ``None``."""
        await self._org_ops.require_org_member(user_id, organization_id)
        result = await self._session.execute(
            select(AgentBudget).where(AgentBudget.organization_id == organization_id)
        )
        return result.scalar_one_or_none()

    async def upsert_org_budget(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        monthly_limit: str | None,
        image_monthly_limit: int | None,
        hard_limit: bool,
        alert_thresholds: list[int],
        reset_day: int,
        currency: str | None = None,
    ) -> AgentBudget:
        """Create or update the org budget row."""
        await self._org_ops.require_org_admin(user_id, organization_id)

        dollar_cap = _parse_decimal(monthly_limit, "monthly_limit")
        if image_monthly_limit is not None and image_monthly_limit < 0:
            raise ValidationError(
                "image_monthly_limit",
                "image_monthly_limit must be non-negative",
            )
        resolved_day = _validate_reset_day(reset_day or 1)
        resolved_thresholds = _validate_thresholds(
            alert_thresholds if alert_thresholds else [50, 75, 90]
        )
        resolved_currency = (
            currency.upper().strip()
            if currency
            else await get_display_currency(self._session, organization_id)
        )

        result = await self._session.execute(
            select(AgentBudget).where(AgentBudget.organization_id == organization_id)
        )
        row = result.scalar_one_or_none()

        now = datetime.now(UTC)
        if row is None:
            row = AgentBudget(
                organization_id=organization_id,
                monthly_limit=dollar_cap,
                image_monthly_limit=image_monthly_limit,
                hard_limit=hard_limit,
                alert_thresholds=resolved_thresholds,
                reset_day=resolved_day,
                currency=resolved_currency,
            )
            self._session.add(row)
            action = "budget.create"
        else:
            row.monthly_limit = dollar_cap
            row.image_monthly_limit = image_monthly_limit
            row.hard_limit = hard_limit
            row.alert_thresholds = resolved_thresholds
            row.reset_day = resolved_day
            row.currency = resolved_currency
            row.updated_at = now
            action = "budget.update"

        await self._session.commit()
        await self._session.refresh(row)

        await create_audit_log(
            self._session,
            organization_id=organization_id,
            user_id=user_id,
            action=action,
            resource_type="budget",
            resource_id=row.id,
            details={
                "monthly_limit": (
                    str(dollar_cap) if dollar_cap is not None else None
                ),
                "image_monthly_limit": image_monthly_limit,
                "hard_limit": hard_limit,
                "reset_day": resolved_day,
            },
        )
        await self._session.commit()
        return row

    async def delete_org_budget(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
    ) -> None:
        """Delete the org budget row; caps revert to defaults."""
        await self._org_ops.require_org_admin(user_id, organization_id)
        result = await self._session.execute(
            select(AgentBudget).where(AgentBudget.organization_id == organization_id)
        )
        row = result.scalar_one_or_none()
        if row is None:
            raise NotFoundError("AgentBudget", str(organization_id))
        row_id = row.id
        await self._session.delete(row)
        await self._session.commit()

        await create_audit_log(
            self._session,
            organization_id=organization_id,
            user_id=user_id,
            action="budget.delete",
            resource_type="budget",
            resource_id=row_id,
        )
        await self._session.commit()

    async def get_user_quota(
        self,
        *,
        actor_user_id: UUID,
        organization_id: UUID,
        target_user_id: UUID,
    ) -> AgentUserQuota | None:
        """Return a user's quota row. Self-access or org admin."""
        if actor_user_id != target_user_id:
            await self._org_ops.require_org_admin(actor_user_id, organization_id)
        else:
            await self._org_ops.require_org_member(actor_user_id, organization_id)

        result = await self._session.execute(
            select(AgentUserQuota).where(
                AgentUserQuota.organization_id == organization_id,
                AgentUserQuota.user_id == target_user_id,
            )
        )
        return result.scalar_one_or_none()

    async def list_user_quotas(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[AgentUserQuota], int]:
        """List all per-user quota rows in an org. Org admin only."""
        await self._org_ops.require_org_admin(user_id, organization_id)

        count_result = await self._session.execute(
            select(func.count(AgentUserQuota.id)).where(
                AgentUserQuota.organization_id == organization_id
            )
        )
        total = int(count_result.scalar() or 0)

        offset = max(0, (page - 1) * page_size)
        result = await self._session.execute(
            select(AgentUserQuota)
            .where(AgentUserQuota.organization_id == organization_id)
            .order_by(AgentUserQuota.created_at.desc())
            .offset(offset)
            .limit(page_size)
        )
        return list(result.scalars().all()), total

    async def upsert_user_quota(
        self,
        *,
        actor_user_id: UUID,
        organization_id: UUID,
        target_user_id: UUID,
        daily_limit: str | None,
        monthly_limit: str | None,
        daily_image_limit: int | None,
        monthly_image_limit: int | None,
        hard_limit: bool,
        currency: str | None = None,
    ) -> AgentUserQuota:
        """Create or update a per-user quota row. Org admin only."""
        await self._org_ops.require_org_admin(actor_user_id, organization_id)

        daily_dollar = _parse_decimal(daily_limit, "daily_limit")
        monthly_dollar = _parse_decimal(monthly_limit, "monthly_limit")
        for label, value in (
            ("daily_image_limit", daily_image_limit),
            ("monthly_image_limit", monthly_image_limit),
        ):
            if value is not None and value < 0:
                raise ValidationError(label, f"{label} must be non-negative")
        resolved_currency = (
            currency.upper().strip()
            if currency
            else await get_display_currency(self._session, organization_id)
        )

        result = await self._session.execute(
            select(AgentUserQuota).where(
                AgentUserQuota.organization_id == organization_id,
                AgentUserQuota.user_id == target_user_id,
            )
        )
        row = result.scalar_one_or_none()

        now = datetime.now(UTC)
        if row is None:
            row = AgentUserQuota(
                organization_id=organization_id,
                user_id=target_user_id,
                daily_limit=daily_dollar,
                monthly_limit=monthly_dollar,
                daily_image_limit=daily_image_limit,
                monthly_image_limit=monthly_image_limit,
                hard_limit=hard_limit,
                currency=resolved_currency,
            )
            self._session.add(row)
            action = "user_quota.create"
        else:
            row.daily_limit = daily_dollar
            row.monthly_limit = monthly_dollar
            row.daily_image_limit = daily_image_limit
            row.monthly_image_limit = monthly_image_limit
            row.hard_limit = hard_limit
            row.currency = resolved_currency
            row.updated_at = now
            action = "user_quota.update"

        await self._session.commit()
        await self._session.refresh(row)

        await create_audit_log(
            self._session,
            organization_id=organization_id,
            user_id=actor_user_id,
            action=action,
            resource_type="user_quota",
            resource_id=row.id,
            details={
                "target_user_id": str(target_user_id),
                "daily_limit": (
                    str(daily_dollar) if daily_dollar is not None else None
                ),
                "monthly_limit": (
                    str(monthly_dollar) if monthly_dollar is not None else None
                ),
                "hard_limit": hard_limit,
            },
        )
        await self._session.commit()
        return row

    async def delete_user_quota(
        self,
        *,
        actor_user_id: UUID,
        organization_id: UUID,
        target_user_id: UUID,
    ) -> None:
        """Delete a per-user quota row. Org admin only."""
        await self._org_ops.require_org_admin(actor_user_id, organization_id)
        result = await self._session.execute(
            select(AgentUserQuota).where(
                AgentUserQuota.organization_id == organization_id,
                AgentUserQuota.user_id == target_user_id,
            )
        )
        row = result.scalar_one_or_none()
        if row is None:
            raise NotFoundError("AgentUserQuota", str(target_user_id))
        row_id = row.id
        await self._session.delete(row)
        await self._session.commit()

        await create_audit_log(
            self._session,
            organization_id=organization_id,
            user_id=actor_user_id,
            action="user_quota.delete",
            resource_type="user_quota",
            resource_id=row_id,
            details={"target_user_id": str(target_user_id)},
        )
        await self._session.commit()

    async def get_current_spend(
        self,
        *,
        actor_user_id: UUID,
        organization_id: UUID,
        target_user_id: UUID | None = None,
        now: datetime | None = None,
    ) -> SpendSummary:
        """Return dollar spend + image count for the current period."""
        now = now or datetime.now(UTC)

        # Auth: non-admin callers can only see their own spend. Admin
        # callers can request any user_id or omit it for org-wide.
        is_admin = await self._is_org_admin(actor_user_id, organization_id)
        if not is_admin:
            if target_user_id is not None and target_user_id != actor_user_id:
                raise PermissionDeniedError(
                    "read_spend", "another user's spend requires org admin"
                )
            target_user_id = actor_user_id

        budget = await self._get_budget_row(organization_id)
        reset_day = budget.reset_day if budget else 1
        period_start, period_end = month_window(reset_day, now)

        filters = [
            AgentRunLog.organization_id == organization_id,
            AgentRunLog.created_at >= period_start,
            AgentRunLog.created_at < period_end,
        ]
        if target_user_id is not None:
            filters.append(AgentRunLog.user_id == target_user_id)

        result = await self._session.execute(
            select(
                func.coalesce(func.sum(AgentRunLog.cost), 0).label("spend"),
                func.coalesce(func.sum(AgentRunLog.image_count), 0).label("images"),
            ).where(*filters)
        )
        row = result.one()
        spend = Decimal(row.spend or 0)
        image_count = int(row.images or 0)

        pct: int | None = None
        if budget is not None and budget.monthly_limit is not None:
            if budget.monthly_limit > 0:
                pct = int(spend / budget.monthly_limit * Decimal(100))
            else:
                pct = 100 if spend > 0 else 0

        currency = budget.currency if budget else await get_display_currency(
            self._session, organization_id
        )

        return SpendSummary(
            organization_id=organization_id,
            period_start=period_start,
            period_end=period_end,
            spend=spend,
            image_count=image_count,
            pct_of_limit=pct,
            currency=currency,
            user_id=target_user_id,
        )

    async def check_preflight(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        now: datetime | None = None,
    ) -> None:
        """Enforce dollar-spend caps before an LLM call.

        Raises ``BudgetExceededError`` only when a row-backed cap with
        ``hard_limit=True`` is already exhausted. Absent rows and null
        columns fall through to "no limit" - there are no default
        dollar caps.

        When any cap is configured a single aggregate query runs over
        the current month window and returns the three values needed
        (user-day, user-month, org-month) via conditional SUMs. One
        index range scan instead of three.
        """
        now = now or datetime.now(UTC)

        budget = await self._get_budget_row(organization_id)
        quota_result = await self._session.execute(
            select(AgentUserQuota).where(
                AgentUserQuota.organization_id == organization_id,
                AgentUserQuota.user_id == user_id,
            )
        )
        quota = quota_result.scalar_one_or_none()

        daily_cap = quota.daily_limit if quota is not None else None
        user_monthly_cap = quota.monthly_limit if quota is not None else None
        org_monthly_cap = budget.monthly_limit if budget is not None else None

        if daily_cap is None and user_monthly_cap is None and org_monthly_cap is None:
            return

        reset_day = budget.reset_day if budget else 1
        period_start, period_end = month_window(reset_day, now)
        day_start, day_end = day_window(now)

        spent = await self._sum_costs_for_preflight(
            organization_id=organization_id,
            user_id=user_id,
            period_start=period_start,
            period_end=period_end,
            day_start=day_start,
            day_end=day_end,
        )

        if daily_cap is not None and spent.user_day >= daily_cap:
            if quota is not None and quota.hard_limit:
                raise BudgetExceededError(
                    scope="user",
                    limit_kind="spend",
                    current=str(spent.user_day),
                    limit=str(daily_cap),
                )
            logger.warning(
                "Soft budget overage (user/daily)",
                user_id=str(user_id),
                organization_id=str(organization_id),
                spent=str(spent.user_day),
                limit=str(daily_cap),
            )

        if user_monthly_cap is not None and spent.user_month >= user_monthly_cap:
            if quota is not None and quota.hard_limit:
                raise BudgetExceededError(
                    scope="user",
                    limit_kind="spend",
                    current=str(spent.user_month),
                    limit=str(user_monthly_cap),
                )
            logger.warning(
                "Soft budget overage (user/monthly)",
                user_id=str(user_id),
                organization_id=str(organization_id),
                spent=str(spent.user_month),
                limit=str(user_monthly_cap),
            )

        if org_monthly_cap is not None and spent.org_month >= org_monthly_cap:
            if budget is not None and budget.hard_limit:
                raise BudgetExceededError(
                    scope="org",
                    limit_kind="spend",
                    current=str(spent.org_month),
                    limit=str(org_monthly_cap),
                )
            logger.warning(
                "Soft budget overage (org/monthly)",
                organization_id=str(organization_id),
                spent=str(spent.org_month),
                limit=str(org_monthly_cap),
            )

    async def _sum_costs_for_preflight(
        self,
        *,
        organization_id: UUID,
        user_id: UUID,
        period_start: datetime,
        period_end: datetime,
        day_start: datetime,
        day_end: datetime,
    ) -> _PreflightSpend:
        """Aggregate user-day, user-month and org-month spend in one query.

        Range scans ``agents_run_logs`` once over ``[period_start, period_end)``
        and emits three conditional SUMs. Uses the
        ``(organization_id, created_at)`` index for the range.
        """
        cost = AgentRunLog.cost
        in_user = AgentRunLog.user_id == user_id
        in_day = and_(
            AgentRunLog.created_at >= day_start,
            AgentRunLog.created_at < day_end,
        )
        zero = sa_literal(0, type_=Numeric)
        result = await self._session.execute(
            select(
                func.coalesce(
                    func.sum(case((and_(in_user, in_day), cost), else_=zero)), 0
                ),
                func.coalesce(
                    func.sum(case((in_user, cost), else_=zero)), 0
                ),
                func.coalesce(func.sum(cost), 0),
            ).where(
                AgentRunLog.organization_id == organization_id,
                AgentRunLog.created_at >= period_start,
                AgentRunLog.created_at < period_end,
            )
        )
        user_day, user_month, org_month = result.one()
        return _PreflightSpend(
            user_day=Decimal(user_day or 0),
            user_month=Decimal(user_month or 0),
            org_month=Decimal(org_month or 0),
        )

    async def _get_budget_row(
        self, organization_id: UUID
    ) -> AgentBudget | None:
        """Internal: load the AgentBudget row without permission checks."""
        result = await self._session.execute(
            select(AgentBudget).where(AgentBudget.organization_id == organization_id)
        )
        return result.scalar_one_or_none()

    async def _sum_cost(
        self,
        *,
        organization_id: UUID,
        user_id: UUID | None,
        period_start: datetime,
        period_end: datetime,
    ) -> Decimal:
        """Sum ``cost_usd`` for run logs in ``[period_start, period_end)``."""
        filters = [
            AgentRunLog.organization_id == organization_id,
            AgentRunLog.created_at >= period_start,
            AgentRunLog.created_at < period_end,
        ]
        if user_id is not None:
            filters.append(AgentRunLog.user_id == user_id)
        result = await self._session.execute(
            select(func.coalesce(func.sum(AgentRunLog.cost), 0)).where(*filters)
        )
        return Decimal(result.scalar() or 0)

    async def _is_org_admin(
        self, user_id: UUID, organization_id: UUID
    ) -> bool:
        """Return True if the user is org admin or org owner."""
        from uniffy.core.models.login.organization_member import OrganizationRole

        membership = await self._org_ops.get_membership(user_id, organization_id)
        if membership is None:
            return False
        return membership.role in (OrganizationRole.ADMIN, OrganizationRole.OWNER)

    async def list_currency_rates(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
    ) -> list[AgentCurrencyRate]:
        """Return all manual exchange rates for an organization."""
        if not await self._is_org_admin(user_id, organization_id):
            raise PermissionDeniedError("read_currency_rates", "requires org admin")
        result = await self._session.execute(
            select(AgentCurrencyRate)
            .where(AgentCurrencyRate.organization_id == organization_id)
            .order_by(AgentCurrencyRate.from_currency, AgentCurrencyRate.to_currency)
        )
        return list(result.scalars())

    async def upsert_currency_rate(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        from_currency: str,
        to_currency: str,
        rate: str,
    ) -> AgentCurrencyRate:
        """Insert or update a single ``(from, to)`` rate row."""
        if not await self._is_org_admin(user_id, organization_id):
            raise PermissionDeniedError("write_currency_rates", "requires org admin")
        from_cur = from_currency.upper().strip()
        to_cur = to_currency.upper().strip()
        if not from_cur or not to_cur:
            raise ValidationError("currency", "from/to currency must be non-empty")
        if from_cur == to_cur:
            raise ValidationError("currency", "from and to currencies must differ")
        try:
            rate_value = Decimal(rate)
        except (InvalidOperation, TypeError) as exc:
            raise ValidationError("rate", f"Invalid rate value: {rate}") from exc
        if rate_value <= 0:
            raise ValidationError("rate", "rate must be positive")

        existing = (
            await self._session.execute(
                select(AgentCurrencyRate).where(
                    AgentCurrencyRate.organization_id == organization_id,
                    AgentCurrencyRate.from_currency == from_cur,
                    AgentCurrencyRate.to_currency == to_cur,
                )
            )
        ).scalar_one_or_none()

        if existing is None:
            row = AgentCurrencyRate(
                organization_id=organization_id,
                from_currency=from_cur,
                to_currency=to_cur,
                rate=rate_value,
            )
            self._session.add(row)
        else:
            existing.rate = rate_value
            existing.updated_at = datetime.now(UTC)
            row = existing
        await self._session.commit()
        await self._session.refresh(row)

        await create_audit_log(
            self._session,
            organization_id=organization_id,
            user_id=user_id,
            action="currency_rate.upsert",
            resource_type="currency_rate",
            resource_id=row.id,
            details={"from": from_cur, "to": to_cur, "rate": str(rate_value)},
        )
        await self._session.commit()
        return row

    async def delete_currency_rate(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        from_currency: str,
        to_currency: str,
    ) -> None:
        """Delete a single ``(from, to)`` rate row."""
        if not await self._is_org_admin(user_id, organization_id):
            raise PermissionDeniedError("write_currency_rates", "requires org admin")
        row = (
            await self._session.execute(
                select(AgentCurrencyRate).where(
                    AgentCurrencyRate.organization_id == organization_id,
                    AgentCurrencyRate.from_currency == from_currency.upper(),
                    AgentCurrencyRate.to_currency == to_currency.upper(),
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFoundError("AgentCurrencyRate", f"{from_currency}->{to_currency}")
        row_id = row.id
        await self._session.delete(row)
        await self._session.commit()

        await create_audit_log(
            self._session,
            organization_id=organization_id,
            user_id=user_id,
            action="currency_rate.delete",
            resource_type="currency_rate",
            resource_id=row_id,
            details={"from": from_currency, "to": to_currency},
        )
        await self._session.commit()

    async def get_display_currency(
        self,
        *,
        organization_id: UUID,
    ) -> str:
        """Return the org's display currency (defaults to ``"EUR"``)."""
        return await get_display_currency(self._session, organization_id)

    async def set_display_currency(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        currency: str,
    ) -> str:
        """Set the org's display currency on the runtime settings row."""
        if not await self._is_org_admin(user_id, organization_id):
            raise PermissionDeniedError("write_display_currency", "requires org admin")
        cur = currency.upper().strip()
        if not cur or len(cur) != 3:
            raise ValidationError("display_currency", "expected ISO 4217 3-letter code")

        from uniffy.core.models.agents.runtime_settings import AgentRuntimeSettings

        existing = (
            await self._session.execute(
                select(AgentRuntimeSettings).where(
                    AgentRuntimeSettings.organization_id == organization_id,
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            row = AgentRuntimeSettings(
                organization_id=organization_id,
                display_currency=cur,
            )
            self._session.add(row)
        else:
            existing.display_currency = cur
            existing.updated_at = datetime.now(UTC)
        await self._session.commit()

        await create_audit_log(
            self._session,
            organization_id=organization_id,
            user_id=user_id,
            action="display_currency.set",
            resource_type="runtime_settings",
            resource_id=organization_id,
            details={"display_currency": cur},
        )
        await self._session.commit()
        return cur


