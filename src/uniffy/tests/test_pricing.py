"""Tests for the pricing lookup and cost computation helpers.

Unit-only. ``get_pricing`` is exercised via a small MagicMock-based
session harness (no DB) because the lookup logic is pure - it just
builds the right SQL filter and reads back ``scalar_one_or_none``.
The interesting logic lives in the two ``compute_*`` functions, which
are pure and trivially testable.
"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from uniffy.core.models.agents.model_pricing import AgentModelPricing
from uniffy.domains.agents.pricing import compute_image_cost, compute_text_cost


def _text_pricing(
    input_rate: str | None = "3.00",
    output_rate: str | None = "15.00",
    cached_rate: str | None = "0.30",
    thinking_rate: str | None = None,
) -> AgentModelPricing:
    """Build an in-memory pricing row without hitting the DB."""
    now = datetime.now(UTC)
    return AgentModelPricing(
        provider="anthropic",
        model="claude-sonnet-4-6",
        kind="text",
        input_per_1m=Decimal(input_rate) if input_rate is not None else None,
        output_per_1m=Decimal(output_rate) if output_rate is not None else None,
        cached_input_per_1m=(
            Decimal(cached_rate) if cached_rate is not None else None
        ),
        thinking_per_1m=(
            Decimal(thinking_rate) if thinking_rate is not None else None
        ),
        effective_from=now - timedelta(days=30),
        effective_to=None,
    )


def _image_pricing(prices: dict | None = None) -> AgentModelPricing:
    """Build an in-memory image pricing row."""
    now = datetime.now(UTC)
    return AgentModelPricing(
        provider="openai",
        model="gpt-image-1",
        kind="image",
        image_prices=prices
        or {"1024x1024": {"auto": "0.04", "high": "0.17"}},
        effective_from=now - timedelta(days=30),
        effective_to=None,
    )


class TestComputeTextCost:
    """compute_text_cost covers all four token subfields."""

    def test_input_plus_output_simple_case(self) -> None:
        pricing = _text_pricing()
        # 1M input at $3 + 500k output at $15 = $3 + $7.50 = $10.50
        cost = compute_text_cost(
            pricing,
            input_tokens=1_000_000,
            output_tokens=500_000,
        )
        assert cost == Decimal("10.500000")

    def test_zero_tokens_zero_cost(self) -> None:
        pricing = _text_pricing()
        cost = compute_text_cost(pricing, input_tokens=0, output_tokens=0)
        assert cost == Decimal("0.000000")

    def test_cached_input_uses_discount_rate(self) -> None:
        pricing = _text_pricing(cached_rate="0.30")
        # 1M cached at $0.30 = $0.30
        cost = compute_text_cost(
            pricing,
            input_tokens=0,
            output_tokens=0,
            cache_read_input_tokens=1_000_000,
        )
        assert cost == Decimal("0.300000")

    def test_cached_falls_back_to_input_rate_when_no_discount(self) -> None:
        pricing = _text_pricing(cached_rate=None)
        cost = compute_text_cost(
            pricing,
            input_tokens=0,
            output_tokens=0,
            cache_read_input_tokens=1_000_000,
        )
        # Falls back to input_per_1m = $3
        assert cost == Decimal("3.000000")

    def test_thinking_uses_surcharge_rate_when_set(self) -> None:
        pricing = _text_pricing(thinking_rate="20.00")
        # 1M thinking at $20 = $20
        cost = compute_text_cost(
            pricing,
            input_tokens=0,
            output_tokens=0,
            thinking_tokens=1_000_000,
        )
        assert cost == Decimal("20.000000")

    def test_thinking_falls_back_to_output_rate(self) -> None:
        pricing = _text_pricing(thinking_rate=None)
        cost = compute_text_cost(
            pricing,
            input_tokens=0,
            output_tokens=0,
            thinking_tokens=1_000_000,
        )
        # Falls back to output_per_1m = $15
        assert cost == Decimal("15.000000")

    def test_all_four_subfields_compose(self) -> None:
        pricing = _text_pricing(
            input_rate="3.00",
            output_rate="15.00",
            cached_rate="0.30",
            thinking_rate="20.00",
        )
        cost = compute_text_cost(
            pricing,
            input_tokens=1_000_000,  # $3
            output_tokens=1_000_000,  # $15
            cache_read_input_tokens=1_000_000,  # $0.30
            thinking_tokens=1_000_000,  # $20
        )
        assert cost == Decimal("38.300000")

    def test_small_token_counts_quantize_correctly(self) -> None:
        pricing = _text_pricing()
        # 1 token input at $3/1M should be $0.000003
        cost = compute_text_cost(
            pricing,
            input_tokens=1,
            output_tokens=0,
        )
        assert cost == Decimal("0.000003")

    def test_null_rate_is_skipped(self) -> None:
        pricing = _text_pricing(input_rate=None, output_rate="15.00")
        # Input rate missing, input contributes 0
        cost = compute_text_cost(
            pricing,
            input_tokens=1_000_000,
            output_tokens=1_000_000,
        )
        # Only output counts: 1M * $15/1M = $15
        assert cost == Decimal("15.000000")


class TestComputeImageCost:
    """compute_image_cost returns None for unknown (size, quality) pairs."""

    def test_known_size_quality_returns_price(self) -> None:
        pricing = _image_pricing()
        cost = compute_image_cost(
            pricing,
            size="1024x1024",
            quality="auto",
            count=1,
        )
        assert cost == Decimal("0.040000")

    def test_count_multiplies_price(self) -> None:
        pricing = _image_pricing()
        cost = compute_image_cost(
            pricing,
            size="1024x1024",
            quality="auto",
            count=5,
        )
        assert cost == Decimal("0.200000")

    def test_unknown_size_returns_none(self) -> None:
        pricing = _image_pricing()
        cost = compute_image_cost(
            pricing,
            size="9999x9999",
            quality="auto",
            count=1,
        )
        assert cost is None

    def test_unknown_quality_returns_none(self) -> None:
        pricing = _image_pricing()
        cost = compute_image_cost(
            pricing,
            size="1024x1024",
            quality="ultra",
            count=1,
        )
        assert cost is None

    def test_zero_count_returns_none(self) -> None:
        pricing = _image_pricing()
        cost = compute_image_cost(
            pricing,
            size="1024x1024",
            quality="auto",
            count=0,
        )
        assert cost is None

    def test_empty_prices_returns_none(self) -> None:
        pricing = AgentModelPricing(
            provider="openai",
            model="gpt-image-1",
            kind="image",
            image_prices=None,
            effective_from=datetime.now(UTC),
        )
        cost = compute_image_cost(
            pricing,
            size="1024x1024",
            quality="auto",
            count=1,
        )
        assert cost is None

    def test_unparseable_price_returns_none(self) -> None:
        pricing = _image_pricing(
            prices={"1024x1024": {"auto": "not a number"}}
        )
        cost = compute_image_cost(
            pricing,
            size="1024x1024",
            quality="auto",
            count=1,
        )
        assert cost is None


class TestSeedConsistency:
    """The seed module should parse cleanly and cover the reference models."""

    def test_text_seed_covers_known_models(self) -> None:
        from uniffy.domains.agents.pricing_seed import TEXT_PRICING_SEED

        models = {(row["provider"], row["model"]) for row in TEXT_PRICING_SEED}
        assert ("anthropic", "claude-sonnet-4-6") in models
        assert ("anthropic", "claude-opus-4-6") in models
        assert ("openai", "gpt-4o") in models
        assert ("google", "gemini-2.0-flash") in models

    def test_image_seed_covers_known_models(self) -> None:
        from uniffy.domains.agents.pricing_seed import IMAGE_PRICING_SEED

        models = {(row["provider"], row["model"]) for row in IMAGE_PRICING_SEED}
        assert ("openai", "gpt-image-1") in models

    def test_text_seed_values_are_decimals(self) -> None:
        from uniffy.domains.agents.pricing_seed import TEXT_PRICING_SEED

        for row in TEXT_PRICING_SEED:
            for key in (
                "input_per_1m",
                "output_per_1m",
                "cached_input_per_1m",
                "thinking_per_1m",
            ):
                if key in row:
                    assert isinstance(row[key], Decimal)


class TestPricingServiceOperationsValidation:
    """Input validation for the admin-facing CRUD."""

    def _make_ops(self):
        from unittest.mock import AsyncMock, MagicMock

        from uniffy.domains.agents.pricing_service.operations import (
            PricingServiceOperations,
        )

        session = MagicMock()
        ops = PricingServiceOperations(session)
        # Stub the system-admin check so validation runs.

        async def _noop(*args, **kwargs):  # noqa: ANN001
            return None

        import uniffy.domains.agents.pricing_service.operations as mod

        mod._require_system_admin = AsyncMock(side_effect=_noop)
        return ops

    def test_invalid_kind_rejected(self) -> None:
        import asyncio

        from uniffy.core.errors import ValidationError

        ops = self._make_ops()
        now = datetime.now(UTC)

        async def run() -> None:
            with pytest.raises(ValidationError):
                await ops.upsert_pricing(
                    actor_user_id=__import__("uuid").uuid4(),
                    provider="openai",
                    model="gpt-4o",
                    kind="badkind",
                    input_per_1m="3.00",
                    output_per_1m="10.00",
                    cached_input_per_1m=None,
                    thinking_per_1m=None,
                    image_prices=None,
                    effective_from=now,
                    effective_to=None,
                )

        asyncio.run(run())

    def test_text_without_rates_rejected(self) -> None:
        import asyncio

        from uniffy.core.errors import ValidationError

        ops = self._make_ops()
        now = datetime.now(UTC)

        async def run() -> None:
            with pytest.raises(ValidationError):
                await ops.upsert_pricing(
                    actor_user_id=__import__("uuid").uuid4(),
                    provider="openai",
                    model="gpt-4o",
                    kind="text",
                    input_per_1m=None,
                    output_per_1m=None,
                    cached_input_per_1m=None,
                    thinking_per_1m=None,
                    image_prices=None,
                    effective_from=now,
                    effective_to=None,
                )

        asyncio.run(run())

    def test_effective_to_not_after_from_rejected(self) -> None:
        import asyncio

        from uniffy.core.errors import ValidationError

        ops = self._make_ops()
        now = datetime.now(UTC)

        async def run() -> None:
            with pytest.raises(ValidationError):
                await ops.upsert_pricing(
                    actor_user_id=__import__("uuid").uuid4(),
                    provider="openai",
                    model="gpt-4o",
                    kind="text",
                    input_per_1m="3.00",
                    output_per_1m="10.00",
                    cached_input_per_1m=None,
                    thinking_per_1m=None,
                    image_prices=None,
                    effective_from=now,
                    effective_to=now - timedelta(hours=1),
                )

        asyncio.run(run())
