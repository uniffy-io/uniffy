"""Tests for the budgets sub-domain.

Covers the dollar-spend preflight and the input validation on the
CRUD operations. DB round-trips are mocked; period math has its own
tests in ``test_image_quota.py`` via the shared ``month_window``.
"""

from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.errors import BudgetExceededError, ValidationError
from uniffy.core.models.agents.budget import AgentBudget
from uniffy.core.models.agents.user_quota import AgentUserQuota
from uniffy.core.types import generate_id
from uniffy.domains.agents.budgets.operations import (
    BudgetsOperations,
    _PreflightSpend,
)


def _spend(value: str) -> _PreflightSpend:
    """All three spend axes set to the same Decimal, for tests that only
    care about one cap firing."""
    d = Decimal(value)
    return _PreflightSpend(user_day=d, user_month=d, org_month=d)


def _make_ops(budget=None, quota=None) -> BudgetsOperations:
    """Build a BudgetsOperations with a session that feeds budget + quota.

    ``_get_budget_row`` runs first in ``check_preflight``, then the quota
    lookup, then one ``_sum_cost`` per configured cap.
    """
    session = MagicMock()
    ops = BudgetsOperations(session)
    ops._org_ops = MagicMock()
    ops._org_ops.require_org_admin = AsyncMock(return_value=None)
    ops._org_ops.require_org_member = AsyncMock(return_value=None)
    ops._org_ops.get_membership = AsyncMock(return_value=None)

    budget_result = MagicMock()
    budget_result.scalar_one_or_none.return_value = budget
    quota_result = MagicMock()
    quota_result.scalar_one_or_none.return_value = quota
    # Preflight calls in order: _get_budget_row, then quota select.
    session.execute = AsyncMock(side_effect=[budget_result, quota_result])
    return ops


class TestCheckPreflightNoConfig:
    """Without any config rows, preflight is always a no-op."""

    async def test_no_budget_no_quota_noop(self) -> None:
        ops = _make_ops()

        async def run() -> None:
            await ops.check_preflight(
                user_id=generate_id(),
                organization_id=generate_id(),
            )

        await run()


class TestCheckPreflightHardUserDaily:
    """A user quota with hard_limit + daily cap rejects on overage."""

    async def test_hard_daily_over_cap_raises(self) -> None:
        org_id = generate_id()
        user_id = generate_id()
        quota = AgentUserQuota(
            organization_id=org_id,
            user_id=user_id,
            daily_limit=Decimal("5.00"),
            hard_limit=True,
        )
        ops = _make_ops(quota=quota)
        ops._sum_costs_for_preflight = AsyncMock(return_value=_spend("5.00"))

        async def run() -> None:
            with pytest.raises(BudgetExceededError) as excinfo:
                await ops.check_preflight(
                    user_id=user_id,
                    organization_id=org_id,
                )
            assert excinfo.value.scope == "user"
            assert excinfo.value.limit_kind == "spend"

        await run()

    async def test_hard_daily_under_cap_passes(self) -> None:
        org_id = generate_id()
        user_id = generate_id()
        quota = AgentUserQuota(
            organization_id=org_id,
            user_id=user_id,
            daily_limit=Decimal("5.00"),
            hard_limit=True,
        )
        ops = _make_ops(quota=quota)
        ops._sum_costs_for_preflight = AsyncMock(return_value=_spend("4.99"))

        async def run() -> None:
            await ops.check_preflight(
                user_id=user_id,
                organization_id=org_id,
            )

        await run()

    async def test_soft_daily_over_cap_warns_but_passes(self) -> None:
        org_id = generate_id()
        user_id = generate_id()
        quota = AgentUserQuota(
            organization_id=org_id,
            user_id=user_id,
            daily_limit=Decimal("5.00"),
            hard_limit=False,
        )
        ops = _make_ops(quota=quota)
        ops._sum_costs_for_preflight = AsyncMock(return_value=_spend("100.00"))

        async def run() -> None:
            await ops.check_preflight(
                user_id=user_id,
                organization_id=org_id,
            )

        await run()


class TestCheckPreflightHardOrgMonthly:
    """Org budget rejection when its monthly dollar cap is crossed."""

    async def test_hard_org_over_cap_raises(self) -> None:
        org_id = generate_id()
        budget = AgentBudget(
            organization_id=org_id,
            monthly_limit=Decimal("100.00"),
            hard_limit=True,
            reset_day=1,
        )
        ops = _make_ops(budget=budget)
        ops._sum_costs_for_preflight = AsyncMock(return_value=_spend("100.00"))

        async def run() -> None:
            with pytest.raises(BudgetExceededError) as excinfo:
                await ops.check_preflight(
                    user_id=generate_id(),
                    organization_id=org_id,
                )
            assert excinfo.value.scope == "org"

        await run()

    async def test_user_cap_overrides_org_cap_when_hit_first(self) -> None:
        """Per-user daily check runs before org monthly; when both are
        tripped, the user-scoped error fires."""
        org_id = generate_id()
        user_id = generate_id()
        quota = AgentUserQuota(
            organization_id=org_id,
            user_id=user_id,
            daily_limit=Decimal("5.00"),
            hard_limit=True,
        )
        budget = AgentBudget(
            organization_id=org_id,
            monthly_limit=Decimal("100.00"),
            hard_limit=True,
            reset_day=1,
        )
        ops = _make_ops(budget=budget, quota=quota)
        ops._sum_costs_for_preflight = AsyncMock(return_value=_spend("1000.00"))

        async def run() -> None:
            with pytest.raises(BudgetExceededError) as excinfo:
                await ops.check_preflight(
                    user_id=user_id,
                    organization_id=org_id,
                )
            # User daily fires first.
            assert excinfo.value.scope == "user"

        await run()


class TestUpsertValidation:
    """Input validation on the write operations."""

    async def test_invalid_reset_day(self) -> None:
        ops = _make_ops()

        async def run() -> None:
            with pytest.raises(ValidationError):
                await ops.upsert_org_budget(
                    user_id=generate_id(),
                    organization_id=generate_id(),
                    monthly_limit="10.00",
                    image_monthly_limit=None,
                    hard_limit=False,
                    alert_thresholds=[50, 75, 90],
                    reset_day=40,
                )

        await run()

    async def test_invalid_threshold(self) -> None:
        ops = _make_ops()

        async def run() -> None:
            with pytest.raises(ValidationError):
                await ops.upsert_org_budget(
                    user_id=generate_id(),
                    organization_id=generate_id(),
                    monthly_limit="10.00",
                    image_monthly_limit=None,
                    hard_limit=False,
                    alert_thresholds=[150],
                    reset_day=1,
                )

        await run()

    async def test_negative_image_limit_rejected(self) -> None:
        ops = _make_ops()

        async def run() -> None:
            with pytest.raises(ValidationError):
                await ops.upsert_org_budget(
                    user_id=generate_id(),
                    organization_id=generate_id(),
                    monthly_limit=None,
                    image_monthly_limit=-1,
                    hard_limit=False,
                    alert_thresholds=[50, 75, 90],
                    reset_day=1,
                )

        await run()

    async def test_unparseable_dollar_rejected(self) -> None:
        ops = _make_ops()

        async def run() -> None:
            with pytest.raises(ValidationError):
                await ops.upsert_org_budget(
                    user_id=generate_id(),
                    organization_id=generate_id(),
                    monthly_limit="not-a-number",
                    image_monthly_limit=None,
                    hard_limit=False,
                    alert_thresholds=[50, 75, 90],
                    reset_day=1,
                )

        await run()


class TestSpendSummary:
    """get_current_spend computes pct_of_limit when a budget is set."""

    async def test_pct_of_limit_at_50_percent(self) -> None:
        org_id = generate_id()
        actor_id = generate_id()
        budget = AgentBudget(
            organization_id=org_id,
            monthly_limit=Decimal("100.00"),
            hard_limit=False,
            reset_day=1,
        )
        ops = _make_ops(budget=budget)
        # _is_org_admin returns True so we can look up org-wide spend.
        ops._is_org_admin = AsyncMock(return_value=True)
        # Return budget row from _get_budget_row.
        spend_result = MagicMock()
        spend_result.one.return_value = MagicMock(spend=Decimal("50.00"), images=0)
        # After the budget lookup (in __init__'s execute side_effect), the
        # aggregate query runs. Override execute for the sum call.
        ops._session.execute = AsyncMock(
            side_effect=[
                MagicMock(scalar_one_or_none=lambda: budget),
                spend_result,
            ]
        )

        async def run() -> None:
            summary = await ops.get_current_spend(
                actor_user_id=actor_id,
                organization_id=org_id,
                target_user_id=None,
                now=datetime(2026, 4, 15, tzinfo=UTC),
            )
            assert summary.spend == Decimal("50.00")
            assert summary.pct_of_limit == 50

        await run()
