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
    get_model,
    load_catalog,
    model_info_for,
    provider_for_model,
)
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

    def test_xai_cache_read_bills_at_cached_rate(self) -> None:
        # xai layout: read rate lives in out_cached (0.30), in_cached is 0
        m = get_pricing(provider="xai", model="grok-4.5")
        cost = compute_text_cost(
            m,
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

    def test_openai_layout_out_cached_is_read(self) -> None:
        m = get_pricing(provider="openai", model="gpt-4o")
        assert cache_read_rate(m) == Decimal("1.25")

    def test_gpt5_layout_in_cached_is_read(self) -> None:
        m = get_pricing(provider="openai", model="gpt-5.5")
        assert cache_read_rate(m) == Decimal("0.5")

    def test_xai_layout_out_cached_is_read(self) -> None:
        m = get_pricing(provider="xai", model="grok-4.5")
        assert cache_read_rate(m) == Decimal("0.30")


class TestCacheWriteRate:
    def test_anthropic_layout_in_cached_is_write(self) -> None:
        assert cache_write_rate(_text_model()) == Decimal("3.75")

    def test_gpt_5_6_layout_in_cached_is_write(self) -> None:
        model = get_pricing(provider="openai", model="gpt-5.6-luna")
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


class TestCatalogResolution:
    """The shipped catalog loads and resolves model ids."""

    def test_catalog_loads_and_covers_reference_models(self) -> None:
        load_catalog()
        assert get_model("anthropic", "claude-opus-5") is not None
        assert get_model("anthropic", "claude-sonnet-4-6") is not None
        assert get_model("openai", "gpt-5.6-luna") is not None
        assert get_model("openai", "gpt-4o") is not None
        assert get_model("google", "gemini-3.6-flash") is not None
        assert get_model("google", "gemini-3.7-flash") is not None
        assert get_model("google", "gemini-3.5-flash-lite") is not None
        assert get_model("google", "gemini-2.5-pro") is not None
        assert get_model("xai", "grok-4.20-multi-agent-0309") is not None

    def test_date_suffix_resolves_to_base(self) -> None:
        # An unseen dated snapshot resolves to the base entry.
        assert get_model("anthropic", "claude-sonnet-4-6-20990101").id == ("claude-sonnet-4-6")
        assert get_model("openai", "gpt-4o-2024-08-06").id == "gpt-4o"

    def test_unrelated_suffix_does_not_resolve_by_prefix(self) -> None:
        assert get_model("openai", "gpt-5-pro") is None
        assert get_model("openai", "gpt-4o-transcribe") is None
        assert get_model("google", "gemini-2.5-flash-preview-tts") is None

    def test_gpt_5_6_luna_current_pricing(self) -> None:
        model = get_model("openai", "gpt-5.6-luna")
        assert model is not None
        assert model.cost_per_1m_in == Decimal("0.2")
        assert model.cost_per_1m_out == Decimal("1.2")

        info = model_info_for("openai", "gpt-5.6-luna")
        assert info is not None
        assert info.cache_read_per_1m == Decimal("0.02")
        assert info.cache_write_per_1m == Decimal("0.25")

    def test_openai_deprecated_models_keep_distinct_metadata(self) -> None:
        image_2 = get_model("openai", "gpt-image-2")
        chatgpt_image = get_model("openai", "chatgpt-image-latest")
        old_codex = get_model("openai", "gpt-5.2-codex")

        assert image_2 is not None
        assert chatgpt_image is not None
        assert old_codex is not None
        assert image_2.id == "gpt-image-2"
        assert chatgpt_image.id == "chatgpt-image-latest"
        assert chatgpt_image.deprecated is True
        assert chatgpt_image.sunset_date == "2026-12-01"
        assert old_codex.deprecated is True
        assert old_codex.sunset_date == "2026-07-23"

    def test_openrouter_slug_resolves(self) -> None:
        assert get_model("openrouter", "anthropic/claude-sonnet-5") is not None
        assert provider_for_model("anthropic/claude-sonnet-5") == "openrouter"

    def test_openrouter_fusion_resolves_without_static_pricing(self) -> None:
        model = get_model("openrouter", "openrouter/fusion")
        assert model is not None
        assert model.dynamic_pricing is True
        assert model.use_responses_api is True
        assert model.context_window == 1000000
        assert model.default_max_tokens is None
        assert model.supports_attachments is False
        assert provider_for_model("openrouter/fusion") == "openrouter"
        assert get_pricing(provider="openrouter", model="openrouter/fusion") is None

        info = model_info_for("openrouter", "openrouter/fusion")
        assert info is not None
        assert info.input_per_1m is None
        assert info.output_per_1m is None

    def test_openrouter_latest_family_aliases_are_distinct_models(self) -> None:
        model_ids = {
            "~openai/gpt-latest",
            "~openai/gpt-mini-latest",
            "~anthropic/claude-fable-latest",
            "~anthropic/claude-opus-latest",
            "~anthropic/claude-sonnet-latest",
            "~anthropic/claude-haiku-latest",
            "~google/gemini-pro-latest",
            "~google/gemini-flash-latest",
            "~x-ai/grok-latest",
            "~deepseek/deepseek-v4-flash-latest",
            "~moonshotai/kimi-latest",
        }

        for model_id in model_ids:
            model = get_model("openrouter", model_id)
            assert model is not None
            assert model.id == model_id
            assert provider_for_model(model_id) == "openrouter"
            assert get_pricing(provider="openrouter", model=model_id) is not None

        gpt_latest = get_model("openrouter", "~openai/gpt-latest")
        assert gpt_latest is not None
        assert gpt_latest.context_window == 1050000
        assert gpt_latest.cost_per_1m_in == Decimal("5")
        assert gpt_latest.cost_per_1m_out == Decimal("30")

    def test_openrouter_deepseek_v4_family_resolves_with_live_pricing(self) -> None:
        expected = {
            "deepseek/deepseek-v4-pro": ("1.168", "2.336", "0.09855", 393216),
            "deepseek/deepseek-v4-pro-0813": ("0.435", "0.87", "0.003625", 384000),
            "deepseek/deepseek-v4-flash": ("0.14", "0.28", "0.028", 393216),
            "deepseek/deepseek-v4-flash-0731": ("0.14", "0.28", "0.028", 393216),
        }
        for model_id, (input_rate, output_rate, cache_rate, max_tokens) in expected.items():
            model = get_model("openrouter", model_id)
            assert model is not None
            assert model.id == model_id
            assert model.cost_per_1m_in == Decimal(input_rate)
            assert model.cost_per_1m_out == Decimal(output_rate)
            assert model.cost_per_1m_out_cached == Decimal(cache_rate)
            assert model.default_max_tokens == max_tokens
            assert model.reasoning_levels == ["high", "xhigh"]

    def test_openrouter_current_gemini_models_resolve_with_live_metadata(self) -> None:
        expected = {
            "google/gemini-3.7-flash": (
                "0.375",
                "1.875",
                "0.0208333333333333",
                "0.0375",
                65536,
                ["low", "medium", "high"],
                "medium",
            ),
            "google/gemini-3.6-flash": (
                "0.75",
                "3.75",
                "0.0416666666666667",
                "0.075",
                65536,
                ["minimal", "low", "medium", "high"],
                "medium",
            ),
            "google/gemini-3.5-flash-lite": (
                "0.3",
                "2.5",
                "0.0833333333333333",
                "0.03",
                65536,
                ["minimal", "low", "medium", "high"],
                "minimal",
            ),
        }
        for model_id, metadata in expected.items():
            (
                input_rate,
                output_rate,
                cache_write_rate,
                cache_read_rate,
                max_tokens,
                levels,
                default,
            ) = metadata
            model = get_model("openrouter", model_id)
            assert model is not None
            assert model.cost_per_1m_in == Decimal(input_rate)
            assert model.cost_per_1m_out == Decimal(output_rate)
            assert model.cost_per_1m_in_cached == Decimal(cache_write_rate)
            assert model.cost_per_1m_out_cached == Decimal(cache_read_rate)
            assert model.default_max_tokens == max_tokens
            assert model.reasoning_levels == levels
            assert model.default_reasoning_effort == default
            assert model.supports_attachments is True

    def test_openrouter_current_qwen_models_resolve_with_live_metadata(self) -> None:
        expected = {
            "qwen/qwen3.8-max": (
                "2",
                "6",
                "2.5",
                "0.25",
                1000000,
                131072,
                True,
            ),
            "qwen/qwen3.8-2.4t-a95b": (
                "2",
                "6",
                "0",
                "0.25",
                1010000,
                262144,
                False,
            ),
            "qwen/qwen3.7-flash": (
                "0.03",
                "0.13",
                "0.038",
                "0.006",
                1000000,
                65536,
                True,
            ),
            "qwen/qwen3.7-plus": (
                "0.32",
                "1.28",
                "0.4",
                "0.064",
                1000000,
                131072,
                True,
            ),
        }
        for model_id, metadata in expected.items():
            (
                input_rate,
                output_rate,
                cache_write_rate,
                cache_read_rate,
                context,
                max_tokens,
                attachments,
            ) = metadata
            model = get_model("openrouter", model_id)
            assert model is not None
            assert model.cost_per_1m_in == Decimal(input_rate)
            assert model.cost_per_1m_out == Decimal(output_rate)
            assert model.cost_per_1m_in_cached == Decimal(cache_write_rate)
            assert model.cost_per_1m_out_cached == Decimal(cache_read_rate)
            assert model.context_window == context
            assert model.default_max_tokens == max_tokens
            assert model.can_reason is True
            assert model.supports_attachments is attachments

        qwen_max = get_model("openrouter", "qwen/qwen3.8-max")
        qwen_open = get_model("openrouter", "qwen/qwen3.8-2.4t-a95b")
        assert qwen_max is not None
        assert qwen_open is not None
        assert qwen_max.reasoning_levels == [
            "minimal",
            "low",
            "medium",
            "high",
            "xhigh",
        ]
        assert qwen_open.reasoning_levels == ["low", "medium", "xhigh"]
        assert qwen_max.default_reasoning_effort == "xhigh"
        assert qwen_open.default_reasoning_effort == "xhigh"

    def test_slug_does_not_shadow_first_party_id(self) -> None:
        assert provider_for_model("claude-sonnet-5") == "anthropic"

    def test_xai_models_resolve(self) -> None:
        assert get_model("xai", "grok-4.6") is not None
        assert get_model("xai", "grok-4.5") is not None
        assert get_model("xai", "grok-99") is None

    def test_latest_gemini_flash_resolves_to_3_7(self) -> None:
        model = get_model("google", "gemini-flash-latest")
        assert model is not None
        assert model.id == "gemini-3.7-flash"

    def test_dated_looking_id_resolves_exactly(self) -> None:
        # The 0309 segment looks like a date. The exact id must still win.
        assert get_model("xai", "grok-4.20-0309-reasoning").id == ("grok-4.20-0309-reasoning")

    def test_unknown_model_returns_none(self) -> None:
        assert get_pricing(provider="openai", model="does-not-exist") is None

    def test_image_model_prices_present(self) -> None:
        m = get_model("openai", "gpt-image-1")
        assert m is not None and m.image_prices is not None


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
