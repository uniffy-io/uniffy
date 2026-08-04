"""Run-scoped provider usage accounting."""

from decimal import Decimal

from uniffy.domains.agents.providers.base import CompletionResult
from uniffy.domains.agents.runtime.run_usage import RunUsageAccumulator


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
