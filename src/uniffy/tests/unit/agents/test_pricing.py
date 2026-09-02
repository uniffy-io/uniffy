"""Tests for catalog-based pricing and cost computation.

Pricing now lives in the model catalog (no DB table, no admin RPC). Cost is
computed from a catalog ``Model`` and frozen on the run log at write time.
"""

from decimal import Decimal

import pytest
from pydantic import ValidationError

from uniffy.domains.agents.pricing import (
    compute_image_cost,
    compute_text_cost,
    get_pricing,
)
from uniffy.domains.agents.providers.catalog import (
    Catalog,
    get_model,
    model_info_for,
    provider_for_model,
)
from uniffy.domains.agents.providers.catalog import loader as catalog_loader
from uniffy.domains.agents.providers.catalog.loader import (
    cache_read_rate,
    cache_write_rate,
)
from uniffy.domains.agents.providers.catalog.schema import Model, ProviderCatalog


def _text_model(
    *,
    cost_in: str = "3.00",
    cost_out: str = "15.00",
    in_cached: str = "3.75",
    out_cached: str = "0.30",
) -> Model:
    """Build an in-memory text model entry."""
    return Model(
        id="claude-sonnet-4-6",
        name="Claude Sonnet 4.6",
        context_window=200_000,
        cost_per_1m_in=cost_in,
        cost_per_1m_out=cost_out,
        cost_per_1m_in_cached=in_cached,
        cost_per_1m_out_cached=out_cached,
    )


def _image_model(prices: dict | None = None) -> Model:
    """Build an in-memory image model entry."""
    return Model(
        id="gpt-image-1",
        name="GPT Image 1",
        context_window=4096,
        image_prices=prices or {"1024x1024": {"auto": "0.04", "high": "0.17"}},
    )


class TestComputeTextCost:
    def test_input_plus_output_simple_case(self) -> None:
        # 1M input at $3 + 500k output at $15 = $3 + $7.50 = $10.50
        cost = compute_text_cost(_text_model(), input_tokens=1_000_000, output_tokens=500_000)
        assert cost == Decimal("10.500000")

    def test_zero_tokens_zero_cost(self) -> None:
        cost = compute_text_cost(_text_model(), input_tokens=0, output_tokens=0)
        assert cost == Decimal("0.000000")

    def test_cache_read_uses_read_rate(self) -> None:
        # read rate is the cheaper cached rate: min(3.75, 0.30) = 0.30
        cost = compute_text_cost(
            _text_model(),
            input_tokens=0,
            output_tokens=0,
            cache_read_input_tokens=1_000_000,
        )
        assert cost == Decimal("0.300000")

    def test_cache_read_falls_back_to_input_rate(self) -> None:
        model = _text_model(in_cached="0", out_cached="0")
        cost = compute_text_cost(
            model,
            input_tokens=0,
            output_tokens=0,
            cache_read_input_tokens=1_000_000,
        )
        # No cached rate -> falls back to input $3
        assert cost == Decimal("3.000000")

    def test_cache_creation_uses_write_rate(self) -> None:
        cost = compute_text_cost(
            _text_model(),
            input_tokens=0,
            output_tokens=0,
            cache_creation_input_tokens=1_000_000,
        )
        assert cost == Decimal("3.750000")

    def test_single_cached_rate_bills_as_cache_read(self) -> None:
        model = _text_model(in_cached="0", out_cached="0.30")
        cost = compute_text_cost(
            model,
            input_tokens=0,
            output_tokens=0,
            cache_read_input_tokens=1_000_000,
        )
        assert cost == Decimal("0.300000")

    def test_thinking_billed_at_output_rate(self) -> None:
        # Catalog has no separate thinking rate; thinking bills at output.
        cost = compute_text_cost(
            _text_model(),
            input_tokens=0,
            output_tokens=0,
            thinking_tokens=1_000_000,
        )
        assert cost == Decimal("15.000000")

    def test_all_buckets_compose(self) -> None:
        cost = compute_text_cost(
            _text_model(),
            input_tokens=1_000_000,  # $3
            output_tokens=1_000_000,  # $15
            cache_creation_input_tokens=1_000_000,  # $3.75
            cache_read_input_tokens=1_000_000,  # $0.30
            thinking_tokens=1_000_000,  # +$15 (at output rate)
        )
        assert cost == Decimal("37.050000")

    def test_small_token_counts_quantize(self) -> None:
        cost = compute_text_cost(_text_model(), input_tokens=1, output_tokens=0)
        assert cost == Decimal("0.000003")

    def test_zero_rate_is_skipped(self) -> None:
        model = _text_model(cost_in="0")
        cost = compute_text_cost(model, input_tokens=1_000_000, output_tokens=1_000_000)
        # Input rate is 0 -> only output counts
        assert cost == Decimal("15.000000")


class TestCacheReadRate:
    """The cache-read rate is the cheaper non-zero cached rate, regardless of
    which catwalk field it lands in."""

    def test_anthropic_layout_out_cached_is_read(self) -> None:
        # in_cached=write(3.75), out_cached=read(0.30)
        assert cache_read_rate(_text_model()) == Decimal("0.30")

    def test_single_cached_rate_is_read(self) -> None:
        model = _text_model(in_cached="0.5", out_cached="0")
        assert cache_read_rate(model) == Decimal("0.5")


class TestCacheWriteRate:
    def test_anthropic_layout_in_cached_is_write(self) -> None:
        assert cache_write_rate(_text_model()) == Decimal("3.75")

    def test_more_expensive_cached_rate_is_write(self) -> None:
        model = _text_model(in_cached="0.25", out_cached="0.02")
        assert cache_write_rate(model) == Decimal("0.25")

    def test_no_cached_rates_returns_none(self) -> None:
        assert cache_read_rate(_text_model(in_cached="0", out_cached="0")) is None


class TestComputeImageCost:
    def test_known_size_quality_returns_price(self) -> None:
        assert compute_image_cost(
            _image_model(), size="1024x1024", quality="auto", count=1
        ) == Decimal("0.040000")

    def test_count_multiplies(self) -> None:
        assert compute_image_cost(
            _image_model(), size="1024x1024", quality="auto", count=5
        ) == Decimal("0.200000")

    def test_unknown_size_returns_none(self) -> None:
        assert compute_image_cost(_image_model(), size="9999x9999", quality="auto", count=1) is None

    def test_unknown_quality_returns_none(self) -> None:
        assert compute_image_cost(_image_model(), size="1024x1024", quality="ultra", count=1) is None

    def test_zero_count_returns_none(self) -> None:
        assert compute_image_cost(_image_model(), size="1024x1024", quality="auto", count=0) is None

    def test_no_image_prices_returns_none(self) -> None:
        model = Model(id="gpt-4o", name="GPT-4o", context_window=128_000)
        assert compute_image_cost(model, size="1024x1024", quality="auto", count=1) is None

    def test_flat_per_image_rate_any_size(self) -> None:
        # Gemini-style: flat per-image regardless of size/quality.
        model = Model(
            id="gemini-3-pro-image",
            name="Nano Banana Pro",
            context_window=131_072,
            cost_per_image="0.134",
        )
        assert compute_image_cost(model, size="anything", quality="whatever", count=2) == Decimal(
            "0.268000"
        )


@pytest.fixture
def mock_catalog(monkeypatch: pytest.MonkeyPatch) -> Catalog:
    catalog = Catalog(
        schema_version=1,
        providers={
            "first-party": ProviderCatalog(
                display_name="First Party",
                models=[
                    Model(
                        id="chat-model",
                        aliases=["chat-latest"],
                        name="Chat Model",
                        cost_per_1m_in="2",
                        cost_per_1m_out="10",
                        cost_per_1m_in_cached="2.5",
                        cost_per_1m_out_cached="0.2",
                        context_window=100000,
                        default_max_tokens=10000,
                        can_reason=True,
                        reasoning_levels=["low", "high"],
                        default_reasoning_effort="high",
                        supports_attachments=True,
                    ),
                    Model(
                        id="retired-model",
                        name="Retired Model",
                        context_window=1000,
                        deprecated=True,
                        sunset_date="2099-12-31",
                    ),
                ],
            ),
            "router": ProviderCatalog(
                display_name="Router",
                models=[
                    Model(
                        id="vendor/chat-model",
                        name="Routed Chat Model",
                        cost_per_1m_in="1",
                        cost_per_1m_out="4",
                        context_window=100000,
                    ),
                    Model(
                        id="~vendor/chat-latest",
                        name="Routed Chat Latest",
                        cost_per_1m_in="1",
                        cost_per_1m_out="4",
                        context_window=100000,
                    ),
                    Model(
                        id="~vendor/chat-fast-latest",
                        name="Routed Chat Fast Latest",
                        cost_per_1m_in="0.5",
                        cost_per_1m_out="2",
                        context_window=50000,
                    ),
                    Model(
                        id="router/fusion",
                        name="Dynamic Router",
                        context_window=1000000,
                        dynamic_pricing=True,
                        use_responses_api=True,
                    ),
                    Model(
                        id="chat-model",
                        name="Shadowed Chat Model",
                        context_window=100000,
                    ),
                ],
            ),
        },
    )
    monkeypatch.setattr(catalog_loader, "get_catalog", lambda: catalog)
    return catalog


@pytest.mark.usefixtures("mock_catalog")
class TestCatalogResolution:
    def test_exact_id_resolves_with_declared_shape(self) -> None:
        model = get_model("first-party", "chat-model")

        assert model is not None
        assert model.can_reason is True
        assert model.reasoning_levels == ["low", "high"]
        assert model.supports_attachments is True

    def test_declared_alias_resolves_to_canonical_model(self) -> None:
        model = get_model("first-party", "chat-latest")

        assert model is not None
        assert model.id == "chat-model"

    def test_date_suffix_resolves_to_base(self) -> None:
        model = get_model("first-party", "chat-model-20990101")

        assert model is not None
        assert model.id == "chat-model"

    def test_unrelated_suffix_does_not_resolve_by_prefix(self) -> None:
        assert get_model("first-party", "chat-model-transcribe") is None

    def test_provider_for_model_routes_slugs(self) -> None:
        assert provider_for_model("vendor/chat-model") == "router"

    def test_first_provider_wins_for_duplicate_model_id(self) -> None:
        assert provider_for_model("chat-model") == "first-party"

    def test_floating_routes_remain_distinct_models(self) -> None:
        model_ids = {"~vendor/chat-latest", "~vendor/chat-fast-latest"}

        for model_id in model_ids:
            model = get_model("router", model_id)
            assert model is not None
            assert model.id == model_id
            assert provider_for_model(model_id) == "router"

    def test_dynamic_model_resolves_without_static_pricing(self) -> None:
        model = get_model("router", "router/fusion")

        assert model is not None
        assert model.dynamic_pricing is True
        assert model.use_responses_api is True
        assert get_pricing(provider="router", model="router/fusion") is None

        info = model_info_for("router", "router/fusion")
        assert info is not None
        assert info.input_per_1m is None
        assert info.output_per_1m is None

    def test_model_info_projects_cache_rates(self) -> None:
        info = model_info_for("first-party", "chat-model")

        assert info is not None
        assert info.cache_read_per_1m == Decimal("0.2")
        assert info.cache_write_per_1m == Decimal("2.5")

    def test_deprecation_metadata_is_preserved(self) -> None:
        model = get_model("first-party", "retired-model")

        assert model is not None
        assert model.deprecated is True
        assert model.sunset_date == "2099-12-31"

    def test_unknown_model_returns_none(self) -> None:
        assert get_pricing(provider="first-party", model="does-not-exist") is None


class TestSchemaValidation:
    """A malformed catalog must fail validation (hard startup error)."""

    def test_duplicate_model_id_rejected(self) -> None:
        dup = {"id": "m1", "name": "M1", "context_window": 1000}
        with pytest.raises(ValidationError):
            ProviderCatalog(display_name="X", models=[Model(**dup), Model(**dup)])

    def test_default_id_must_exist(self) -> None:
        with pytest.raises(ValidationError):
            ProviderCatalog(
                display_name="X",
                default_large_model_id="ghost",
                models=[Model(id="m1", name="M1", context_window=1000)],
            )

    def test_default_reasoning_effort_must_be_a_level(self) -> None:
        with pytest.raises(ValidationError):
            Model(
                id="m1",
                name="M1",
                context_window=1000,
                can_reason=True,
                reasoning_levels=["low", "high"],
                default_reasoning_effort="medium",
            )

    def test_context_window_must_be_positive(self) -> None:
        with pytest.raises(ValidationError):
            Model(id="m1", name="M1", context_window=0)

    def test_dynamic_pricing_rejects_static_rates(self) -> None:
        with pytest.raises(ValidationError, match="cannot declare static rates"):
            Model(
                id="router",
                name="Router",
                context_window=1000,
                dynamic_pricing=True,
                cost_per_1m_in=1,
            )
