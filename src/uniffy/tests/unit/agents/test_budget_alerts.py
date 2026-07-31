"""Tests for the budget alert threshold + fan-out logic.

Threshold-crossing math is pure and covered directly. The full
check_and_fire_alerts path is exercised with a MagicMock session that
simulates both "first fire" (dedupe claim succeeds) and "already fired"
(IntegrityError) scenarios.
"""

from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

from sqlalchemy.exc import IntegrityError

from uniffy.core.models.agents.budget import AgentBudget
from uniffy.core.types import generate_id
from uniffy.domains.agents import budget_alerts as mod
from uniffy.domains.agents.budget_alerts import (
    _compute_crossings,
    check_and_fire_alerts,
)


class TestComputeCrossings:
    """The pure threshold-crossing predicate."""

    def test_no_crossings_when_under_smallest_threshold(self) -> None:
        # 10% -> 20% of 100 cap
        assert _compute_crossings(
            Decimal("10"), Decimal("20"), Decimal("100"), [50, 75, 90, 100]
        ) == []

    def test_single_crossing_at_50(self) -> None:
        assert _compute_crossings(
            Decimal("40"), Decimal("60"), Decimal("100"), [50, 75, 90, 100]
        ) == [50]

    def test_multiple_crossings_in_one_step(self) -> None:
        # 40 -> 95: crosses 50, 75, 90 in one shot.
        assert _compute_crossings(
            Decimal("40"), Decimal("95"), Decimal("100"), [50, 75, 90, 100]
        ) == [50, 75, 90]

    def test_exactly_at_threshold_crosses(self) -> None:
        assert _compute_crossings(
            Decimal("49"), Decimal("50"), Decimal("100"), [50]
        ) == [50]

    def test_already_past_threshold_does_not_recross(self) -> None:
        assert _compute_crossings(
            Decimal("55"), Decimal("70"), Decimal("100"), [50]
        ) == []

    def test_zero_cap_returns_empty(self) -> None:
        assert _compute_crossings(
            Decimal("0"), Decimal("10"), Decimal("0"), [50]
        ) == []

    def test_one_hundred_threshold_requires_exact_cross(self) -> None:
        # Prev at 99.5, curr at 100: crosses.
        assert _compute_crossings(
            Decimal("99.5"), Decimal("100"), Decimal("100"), [100]
        ) == [100]
        # Prev at 100, curr at 120: already past, no fire.
        assert _compute_crossings(
            Decimal("100"), Decimal("120"), Decimal("100"), [100]
        ) == []


def _bare_session(budget: AgentBudget | None) -> MagicMock:
    """Build a session that returns ``budget`` for the first scalar lookup."""
    session = MagicMock()
    budget_result = MagicMock()
    budget_result.scalar_one_or_none.return_value = budget
    session.execute = AsyncMock(return_value=budget_result)
    session.commit = AsyncMock(return_value=None)
    session.add = MagicMock()
    return session


class TestCheckAndFireAlertsEdges:
    """Boundary cases that short-circuit before any fan-out."""

    async def test_no_cost_no_images_early_return(self) -> None:
        session = _bare_session(None)

        async def run() -> None:
            await check_and_fire_alerts(
                session,
                organization_id=generate_id(),
                run_cost=Decimal(0),
                run_image_count=0,
            )

        await run()
        # Session's execute should never run: we early-returned.
        session.execute.assert_not_called()

    async def test_missing_budget_row_is_noop(self) -> None:
        # Cost is non-zero but there is no budget row, so no thresholds.
        session = _bare_session(None)

        async def run() -> None:
            await check_and_fire_alerts(
                session,
                organization_id=generate_id(),
                run_cost=Decimal("10"),
                run_image_count=0,
            )

        await run()
        # Only the budget lookup ran; no further queries or commits.
        assert session.execute.call_count == 1

    async def test_unlimited_budget_is_noop(self) -> None:
        org_id = generate_id()
        budget = AgentBudget(
            organization_id=org_id,
            monthly_limit=None,
            image_monthly_limit=None,
            hard_limit=False,
            reset_day=1,
        )
        session = _bare_session(budget)

        async def run() -> None:
            await check_and_fire_alerts(
                session,
                organization_id=org_id,
                run_cost=Decimal("10"),
                run_image_count=1,
            )

        await run()


class TestCheckAndFireAlertsFires:
    """End-to-end fan-out path with patched aggregate helpers."""

    def _ops_with_budget(self, budget: AgentBudget) -> MagicMock:
        """Session that yields the budget then accepts add/commit calls."""
        session = MagicMock()
        session.commit = AsyncMock(return_value=None)
        session.flush = AsyncMock(return_value=None)
        session.add = MagicMock()

        budget_result = MagicMock()
        budget_result.scalar_one_or_none.return_value = budget
        session.execute = AsyncMock(return_value=budget_result)

        # Stub the nested transaction context manager used for dedupe.
        class _Nested:
            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

        session.begin_nested = MagicMock(return_value=_Nested())
        return session

    async def test_fires_on_first_crossing(self) -> None:
        org_id = generate_id()
        budget = AgentBudget(
            organization_id=org_id,
            monthly_limit=Decimal("100.00"),
            hard_limit=False,
            reset_day=1,
        )
        session = self._ops_with_budget(budget)

        async def run() -> None:
            with (
                patch.object(
                    mod, "_sum_cost", AsyncMock(return_value=Decimal("60"))
                ),
                patch.object(
                    mod,
                    "_resolve_recipients",
                    AsyncMock(return_value=[generate_id(), generate_id()]),
                ),
            ):
                await check_and_fire_alerts(
                    session,
                    organization_id=org_id,
                    run_cost=Decimal("20"),  # 40 -> 60 crosses 50
                    run_image_count=0,
                )

        await run()
        # Alert dedupe row + 2 notifications = 3 session.add calls.
        assert session.add.call_count == 3

    async def test_skips_already_fired_threshold(self) -> None:
        org_id = generate_id()
        budget = AgentBudget(
            organization_id=org_id,
            monthly_limit=Decimal("100.00"),
            hard_limit=False,
            reset_day=1,
        )
        session = self._ops_with_budget(budget)

        # Dedupe row insert raises IntegrityError -> alert already fired.
        class _Nested:
            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                raise IntegrityError("stmt", {}, Exception("dupe"))

        session.begin_nested = MagicMock(return_value=_Nested())

        async def run() -> None:
            with (
                patch.object(
                    mod, "_sum_cost", AsyncMock(return_value=Decimal("60"))
                ),
                patch.object(
                    mod,
                    "_resolve_recipients",
                    AsyncMock(return_value=[generate_id()]),
                ),
            ):
                await check_and_fire_alerts(
                    session,
                    organization_id=org_id,
                    run_cost=Decimal("20"),
                    run_image_count=0,
                )

        await run()
        # No notifications sent because the claim failed.
        # The dedupe attempt still added a pending row, so count == 1.
        assert session.add.call_count == 1

    async def test_errors_are_swallowed(self) -> None:
        org_id = generate_id()
        session = MagicMock()
        session.execute = AsyncMock(side_effect=RuntimeError("db dead"))

        async def run() -> None:
            # Never raises even when the first query explodes.
            await check_and_fire_alerts(
                session,
                organization_id=org_id,
                run_cost=Decimal("10"),
                run_image_count=0,
            )

        await run()
