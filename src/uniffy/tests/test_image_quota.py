"""Tests for the image-generation quota helper.

Uses MagicMock sessions because the helper just runs a few reads. The
month-window math is pure and has its own direct tests.
"""

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from uniffy.core.errors import BudgetExceededError
from uniffy.core.models.agents.budget import AgentBudget
from uniffy.core.models.agents.user_quota import AgentUserQuota
from uniffy.domains.agents.budgets import image_quota as mod
from uniffy.domains.agents.budgets.defaults import (
    DEFAULT_DAILY_IMAGE_LIMIT_PER_USER,
    DEFAULT_MONTHLY_IMAGE_LIMIT_PER_ORG,
)
from uniffy.domains.agents.budgets.image_quota import check_image_quota
from uniffy.domains.agents.budgets.period import month_window as _month_window


def _mock_session(
    *,
    quota: AgentUserQuota | None = None,
    budget: AgentBudget | None = None,
) -> MagicMock:
    """Return a MagicMock that feeds a quota row and a budget row in order."""
    session = MagicMock()

    quota_result = MagicMock()
    quota_result.scalar_one_or_none.return_value = quota
    budget_result = MagicMock()
    budget_result.scalar_one_or_none.return_value = budget

    session.execute = AsyncMock(side_effect=[quota_result, budget_result])
    return session


class TestMonthWindow:
    """The half-open ``[start, end)`` window math."""

    def test_reset_day_already_passed_this_month(self) -> None:
        now = datetime(2026, 4, 15, tzinfo=UTC)
        start, end = _month_window(1, now)
        assert start == datetime(2026, 4, 1, tzinfo=UTC)
        assert end == datetime(2026, 5, 1, tzinfo=UTC)

    def test_reset_day_not_yet_reached(self) -> None:
        now = datetime(2026, 4, 5, tzinfo=UTC)
        start, end = _month_window(15, now)
        assert start == datetime(2026, 3, 15, tzinfo=UTC)
        assert end == datetime(2026, 4, 15, tzinfo=UTC)

    def test_reset_day_clamps_to_short_month(self) -> None:
        now = datetime(2026, 2, 15, tzinfo=UTC)
        start, end = _month_window(31, now)
        # Feb 2026 has 28 days, Jan has 31.
        assert start == datetime(2026, 1, 31, tzinfo=UTC)
        # End is one month later clamped to Feb's last day.
        assert end == datetime(2026, 2, 28, tzinfo=UTC)

    def test_january_rolls_to_previous_december(self) -> None:
        now = datetime(2026, 1, 5, tzinfo=UTC)
        start, end = _month_window(15, now)
        assert start == datetime(2025, 12, 15, tzinfo=UTC)
        assert end == datetime(2026, 1, 15, tzinfo=UTC)


class TestCheckImageQuotaNoRows:
    """No quota or budget rows -> server defaults, always soft."""

    def test_under_daily_default_is_noop(self) -> None:
        session = _mock_session()

        async def run() -> None:
            with (
                patch.object(
                    mod,
                    "_count_images_today_for_user",
                    AsyncMock(return_value=0),
                ),
                patch.object(
                    mod,
                    "_count_images_this_month_for_org",
                    AsyncMock(return_value=0),
                ),
            ):
                await check_image_quota(
                    session,
                    user_id=uuid4(),
                    organization_id=uuid4(),
                )

        asyncio.run(run())

    def test_over_daily_default_is_warn_not_hard(self) -> None:
        session = _mock_session()

        async def run() -> None:
            with (
                patch.object(
                    mod,
                    "_count_images_today_for_user",
                    AsyncMock(
                        return_value=DEFAULT_DAILY_IMAGE_LIMIT_PER_USER + 1
                    ),
                ),
                patch.object(
                    mod,
                    "_count_images_this_month_for_org",
                    AsyncMock(return_value=0),
                ),
            ):
                # Defaults alone never raise; the overage just logs.
                await check_image_quota(
                    session,
                    user_id=uuid4(),
                    organization_id=uuid4(),
                )

        asyncio.run(run())

    def test_over_monthly_default_is_warn_not_hard(self) -> None:
        session = _mock_session()

        async def run() -> None:
            with (
                patch.object(
                    mod,
                    "_count_images_today_for_user",
                    AsyncMock(return_value=0),
                ),
                patch.object(
                    mod,
                    "_count_images_this_month_for_org",
                    AsyncMock(
                        return_value=DEFAULT_MONTHLY_IMAGE_LIMIT_PER_ORG + 10
                    ),
                ),
            ):
                await check_image_quota(
                    session,
                    user_id=uuid4(),
                    organization_id=uuid4(),
                )

        asyncio.run(run())


class TestCheckImageQuotaWithHardLimit:
    """Row-backed caps with hard_limit=True raise BudgetExceededError."""

    def test_user_quota_hard_rejects(self) -> None:
        org_id = uuid4()
        user_id = uuid4()
        quota = AgentUserQuota(
            organization_id=org_id,
            user_id=user_id,
            daily_image_limit=5,
            hard_limit=True,
        )
        session = _mock_session(quota=quota)

        async def run() -> None:
            with (
                patch.object(
                    mod,
                    "_count_images_today_for_user",
                    AsyncMock(return_value=5),  # at the cap
                ),
                patch.object(
                    mod,
                    "_count_images_this_month_for_org",
                    AsyncMock(return_value=0),
                ),
            ):
                with pytest.raises(BudgetExceededError) as excinfo:
                    await check_image_quota(
                        session,
                        user_id=user_id,
                        organization_id=org_id,
                    )
                assert excinfo.value.scope == "user"
                assert excinfo.value.limit_kind == "image_count"
                assert excinfo.value.limit == "5"

        asyncio.run(run())

    def test_org_budget_hard_rejects_monthly(self) -> None:
        org_id = uuid4()
        budget = AgentBudget(
            organization_id=org_id,
            image_monthly_limit=100,
            hard_limit=True,
            reset_day=1,
        )
        session = _mock_session(budget=budget)

        async def run() -> None:
            with (
                patch.object(
                    mod,
                    "_count_images_today_for_user",
                    AsyncMock(return_value=0),
                ),
                patch.object(
                    mod,
                    "_count_images_this_month_for_org",
                    AsyncMock(return_value=100),
                ),
            ):
                with pytest.raises(BudgetExceededError) as excinfo:
                    await check_image_quota(
                        session,
                        user_id=uuid4(),
                        organization_id=org_id,
                    )
                assert excinfo.value.scope == "org"

        asyncio.run(run())

    def test_user_quota_hard_but_under_cap_passes(self) -> None:
        org_id = uuid4()
        user_id = uuid4()
        quota = AgentUserQuota(
            organization_id=org_id,
            user_id=user_id,
            daily_image_limit=5,
            hard_limit=True,
        )
        session = _mock_session(quota=quota)

        async def run() -> None:
            with (
                patch.object(
                    mod,
                    "_count_images_today_for_user",
                    AsyncMock(return_value=4),
                ),
                patch.object(
                    mod,
                    "_count_images_this_month_for_org",
                    AsyncMock(return_value=0),
                ),
            ):
                await check_image_quota(
                    session,
                    user_id=user_id,
                    organization_id=org_id,
                )

        asyncio.run(run())


class TestCheckImageQuotaSoftRows:
    """Row-backed caps with hard_limit=False log but never raise."""

    def test_user_quota_soft_logs_on_overage(self) -> None:
        org_id = uuid4()
        user_id = uuid4()
        quota = AgentUserQuota(
            organization_id=org_id,
            user_id=user_id,
            daily_image_limit=5,
            hard_limit=False,
        )
        session = _mock_session(quota=quota)

        async def run() -> None:
            with (
                patch.object(
                    mod,
                    "_count_images_today_for_user",
                    AsyncMock(return_value=10),
                ),
                patch.object(
                    mod,
                    "_count_images_this_month_for_org",
                    AsyncMock(return_value=0),
                ),
            ):
                # Does not raise.
                await check_image_quota(
                    session,
                    user_id=user_id,
                    organization_id=org_id,
                )

        asyncio.run(run())

    def test_quota_with_null_daily_falls_back_to_default_soft(self) -> None:
        """If the row has a null daily cap, the fallback is always soft."""
        org_id = uuid4()
        user_id = uuid4()
        quota = AgentUserQuota(
            organization_id=org_id,
            user_id=user_id,
            daily_image_limit=None,  # null column
            hard_limit=True,  # hard_limit ignored for this bucket
        )
        session = _mock_session(quota=quota)

        async def run() -> None:
            with (
                patch.object(
                    mod,
                    "_count_images_today_for_user",
                    AsyncMock(
                        return_value=DEFAULT_DAILY_IMAGE_LIMIT_PER_USER + 100
                    ),
                ),
                patch.object(
                    mod,
                    "_count_images_this_month_for_org",
                    AsyncMock(return_value=0),
                ),
            ):
                # Even though hard_limit=True on the row, the default cap
                # is never hard-enforced.
                await check_image_quota(
                    session,
                    user_id=user_id,
                    organization_id=org_id,
                )

        asyncio.run(run())
