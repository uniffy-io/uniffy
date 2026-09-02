"""Run-scoped provider usage accounting."""

from decimal import Decimal

from uniffy.domains.agents.providers.base import CompletionResult
from uniffy.domains.agents.runtime.runs.usage import RunUsageAccumulator


def test_accumulates_every_model_call_and_prices_each_model() -> None:
    usage = RunUsageAccumulator()
    usage.record_result(
        provider="openai",
        provider_key_id=None,
        result=CompletionResult(
            content="",
            model="gpt-5.6-luna",
            input_tokens=1_000_000,
            output_tokens=1_000_000,
            cache_creation_input_tokens=1_000_000,
            cache_read_input_tokens=1_000_000,
        ),
    )
    usage.record_result(
        provider="anthropic",
        provider_key_id=None,
        result=CompletionResult(
            content="done",
            model="claude-sonnet-4-6",
            input_tokens=1_000_000,
            output_tokens=1_000_000,
        ),
    )

    assert usage.input_tokens == 2_000_000
    assert usage.cache_creation_input_tokens == 1_000_000
    assert usage.cache_read_input_tokens == 1_000_000
    assert usage.cost_usd() == Decimal("19.670000")
    assert [call["model"] for call in usage.to_list()] == [
        "gpt-5.6-luna",
        "claude-sonnet-4-6",
    ]


def test_failure_keeps_prior_usage_without_guessing_extra_tokens() -> None:
    usage = RunUsageAccumulator()
    usage.record_result(
        provider="openai",
        provider_key_id=None,
        result=CompletionResult(
            content="",
            model="gpt-5.6-luna",
            input_tokens=100,
            output_tokens=20,
        ),
    )
    usage.record_failure(
        provider="openai",
        provider_key_id=None,
        model="gpt-5.6-luna",
        error="provider_error",
    )

    assert usage.input_tokens == 100
    assert usage.output_tokens == 20
    assert usage.retry_count == 1
    assert usage.to_list()[-1]["status"] == "error"


def test_provider_cost_prices_dynamic_router_and_keeps_requested_model() -> None:
    usage = RunUsageAccumulator()
    usage.record_result(
        provider="openrouter",
        provider_key_id=None,
        model="openrouter/fusion",
        result=CompletionResult(
            content="done",
            model="anthropic/claude-opus-4.8",
            input_tokens=100,
            output_tokens=20,
            provider_cost_usd=Decimal("0.012345"),
        ),
    )

    assert usage.calls[0].model == "openrouter/fusion"
    assert usage.calls[0].resolved_model == "anthropic/claude-opus-4.8"
    assert usage.cost_usd() == Decimal("0.012345")
    assert usage.to_list()[0]["cost_usd"] == "0.012345"
    assert usage.to_list()[0]["resolved_model"] == "anthropic/claude-opus-4.8"


def test_dynamic_router_cost_stays_unknown_without_provider_cost() -> None:
    usage = RunUsageAccumulator()
    usage.record_result(
        provider="openrouter",
        provider_key_id=None,
        model="openrouter/fusion",
        result=CompletionResult(content="done", model="openrouter/fusion"),
    )

    assert usage.cost_usd() is None


def test_provider_cost_overrides_catalog_estimate() -> None:
    usage = RunUsageAccumulator()
    usage.record_result(
        provider="openrouter",
        provider_key_id=None,
        result=CompletionResult(
            content="done",
            model="openai/gpt-5.6-luna",
            input_tokens=1_000_000,
            output_tokens=1_000_000,
            provider_cost_usd=Decimal("1.234567"),
        ),
    )

    assert usage.cost_usd() == Decimal("1.234567")
