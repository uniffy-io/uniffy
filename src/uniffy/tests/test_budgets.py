"""Tests for the budgets sub-domain.

Covers the dollar-spend preflight and the input validation on the
CRUD operations. DB round-trips are mocked; period math has its own
tests in ``test_image_quota.py`` via the shared ``month_window``.
"""

import asyncio
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from uniffy.core.errors import BudgetExceededError, ValidationError
from uniffy.core.models.agents.budget import AgentBudget
from uniffy.core.models.agents.user_quota import AgentUserQuota
from uniffy.domains.agents.budgets.operations import BudgetsOperations


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

    def test_no_budget_no_quota_noop(self) -> None:
        ops = _make_ops()

        async def run() -> None:
            await ops.check_preflight(
                user_id=uuid4(),
                organization_id=uuid4(),
            )

        asyncio.run(run())


class TestCheckPreflightHardUserDaily:
    """A user quota with hard_limit + daily cap rejects on overage."""

    def test_hard_daily_over_cap_raises(self) -> None:
        org_id = uuid4()
        user_id = uuid4()
        quota = AgentUserQuota(
            organization_id=org_id,
            user_id=user_id,
            daily_limit_usd=Decimal("5.00"),
            hard_limit=True,
        )
        ops = _make_ops(quota=quota)
        ops._sum_cost = AsyncMock(return_value=Decimal("5.00"))

        async def run() -> None:
            with pytest.raises(BudgetExceededError) as excinfo:
                await ops.check_preflight(
                    user_id=user_id,
                    organization_id=org_id,
                )
            assert excinfo.value.scope == "user"
            assert excinfo.value.limit_kind == "spend"

        asyncio.run(run())

    def test_hard_daily_under_cap_passes(self) -> None:
        org_id = uuid4()
        user_id = uuid4()
        quota = AgentUserQuota(
            organization_id=org_id,
            user_id=user_id,
            daily_limit_usd=Decimal("5.00"),
            hard_limit=True,
        )
        ops = _make_ops(quota=quota)
        ops._sum_cost = AsyncMock(return_value=Decimal("4.99"))

        async def run() -> None:
            await ops.check_preflight(
                user_id=user_id,
                organization_id=org_id,
            )

        asyncio.run(run())

    def test_soft_daily_over_cap_warns_but_passes(self) -> None:
        org_id = uuid4()
        user_id = uuid4()
        quota = AgentUserQuota(
            organization_id=org_id,
            user_id=user_id,
            daily_limit_usd=Decimal("5.00"),
            hard_limit=False,
        )
        ops = _make_ops(quota=quota)
        ops._sum_cost = AsyncMock(return_value=Decimal("100.00"))

        async def run() -> None:
            await ops.check_preflight(
                user_id=user_id,
                organization_id=org_id,
            )

        asyncio.run(run())


class TestCheckPreflightHardOrgMonthly:
    """Org budget rejection when its monthly dollar cap is crossed."""

    def test_hard_org_over_cap_raises(self) -> None:
        org_id = uuid4()
        budget = AgentBudget(
            organization_id=org_id,
            monthly_limit_usd=Decimal("100.00"),
            hard_limit=True,
            reset_day=1,
        )
        ops = _make_ops(budget=budget)
        ops._sum_cost = AsyncMock(return_value=Decimal("100.00"))

        async def run() -> None:
            with pytest.raises(BudgetExceededError) as excinfo:
                await ops.check_preflight(
                    user_id=uuid4(),
                    organization_id=org_id,
                )
            assert excinfo.value.scope == "org"

        asyncio.run(run())

    def test_user_cap_overrides_org_cap_when_hit_first(self) -> None:
        """Per-user daily check runs before org monthly; when both are
        tripped, the user-scoped error fires."""
        org_id = uuid4()
        user_id = uuid4()
        quota = AgentUserQuota(
            organization_id=org_id,
            user_id=user_id,
            daily_limit_usd=Decimal("5.00"),
            hard_limit=True,
        )
        budget = AgentBudget(
            organization_id=org_id,
            monthly_limit_usd=Decimal("100.00"),
            hard_limit=True,
            reset_day=1,
        )
        ops = _make_ops(budget=budget, quota=quota)
        ops._sum_cost = AsyncMock(return_value=Decimal("1000.00"))

        async def run() -> None:
            with pytest.raises(BudgetExceededError) as excinfo:
                await ops.check_preflight(
                    user_id=user_id,
                    organization_id=org_id,
                )
            # User daily fires first.
            assert excinfo.value.scope == "user"

        asyncio.run(run())


class TestUpsertValidation:
    """Input validation on the write operations."""

    def test_invalid_reset_day(self) -> None:
        ops = _make_ops()

        async def run() -> None:
            with pytest.raises(ValidationError):
                await ops.upsert_org_budget(
                    user_id=uuid4(),
                    organization_id=uuid4(),
                    monthly_limit_usd="10.00",
                    image_monthly_limit=None,
                    hard_limit=False,
                    alert_thresholds=[50, 75, 90],
                    reset_day=40,
                )

        asyncio.run(run())

    def test_invalid_threshold(self) -> None:
        ops = _make_ops()

        async def run() -> None:
            with pytest.raises(ValidationError):
                await ops.upsert_org_budget(
                    user_id=uuid4(),
                    organization_id=uuid4(),
                    monthly_limit_usd="10.00",
                    image_monthly_limit=None,
                    hard_limit=False,
                    alert_thresholds=[150],
                    reset_day=1,
                )

        asyncio.run(run())

    def test_negative_image_limit_rejected(self) -> None:
        ops = _make_ops()

        async def run() -> None:
            with pytest.raises(ValidationError):
                await ops.upsert_org_budget(
                    user_id=uuid4(),
                    organization_id=uuid4(),
                    monthly_limit_usd=None,
                    image_monthly_limit=-1,
                    hard_limit=False,
                    alert_thresholds=[50, 75, 90],
                    reset_day=1,
                )

        asyncio.run(run())

    def test_unparseable_dollar_rejected(self) -> None:
        ops = _make_ops()

        async def run() -> None:
            with pytest.raises(ValidationError):
                await ops.upsert_org_budget(
                    user_id=uuid4(),
                    organization_id=uuid4(),
                    monthly_limit_usd="not-a-number",
                    image_monthly_limit=None,
                    hard_limit=False,
                    alert_thresholds=[50, 75, 90],
                    reset_day=1,
                )

        asyncio.run(run())


class TestSpendSummary:
    """get_current_spend computes pct_of_limit when a budget is set."""

    def test_pct_of_limit_at_50_percent(self) -> None:
        org_id = uuid4()
        actor_id = uuid4()
        budget = AgentBudget(
            organization_id=org_id,
            monthly_limit_usd=Decimal("100.00"),
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
            assert summary.spend_usd == Decimal("50.00")
            assert summary.pct_of_limit == 50

        asyncio.run(run())
