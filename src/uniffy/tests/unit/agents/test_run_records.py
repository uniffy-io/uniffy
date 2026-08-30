"""Agent runtime run-record persistence and accounting."""

from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.errors import ValidationError
from uniffy.core.models.agents.run_log import AgentRunStatus
from uniffy.core.types import generate_id
from uniffy.domains.agents.providers.base import CompletionResult
from uniffy.domains.agents.runtime.runs.records import RunRecorder
from uniffy.domains.agents.runtime.runs.usage import RunUsageAccumulator


def _session() -> MagicMock:
    session = MagicMock()
    session.commit = AsyncMock()
    return session


def _usage(
    *,
    provider_key_id=None,
    model: str = "gpt-5.6-luna",
) -> RunUsageAccumulator:
    usage = RunUsageAccumulator()
    usage.record_result(
        provider="openai",
        provider_key_id=provider_key_id,
        model=model,
        result=CompletionResult(
            content="done",
            model=model,
            input_tokens=100,
            output_tokens=20,
            cache_creation_input_tokens=10,
            cache_read_input_tokens=5,
            thinking_tokens=3,
        ),
    )
    return usage


async def test_record_persists_complete_usage_and_fires_alerts() -> None:
    session = _session()
    organization_id = generate_id()
    primary_key_id = generate_id()
    fallback_key_id = generate_id()
    usage = RunUsageAccumulator()
    usage.record_failure(
        provider="anthropic",
        provider_key_id=primary_key_id,
        model="claude-sonnet-4-6",
        error="TimeoutError",
    )
    usage.record_result(
        provider="openai",
        provider_key_id=fallback_key_id,
        model="gpt-5.6-luna",
        result=CompletionResult(
            content="done",
            model="gpt-5.6-luna",
            input_tokens=100,
            output_tokens=20,
            cache_creation_input_tokens=10,
            cache_read_input_tokens=5,
            thinking_tokens=3,
        ),
    )
    alert = AsyncMock()

    with (
        patch(
            "uniffy.domains.agents.runtime.runs.records.get_display_currency",
            AsyncMock(return_value="EUR"),
        ),
        patch(
            "uniffy.domains.agents.runtime.runs.records.convert_currency",
            AsyncMock(return_value=Decimal("0.420000")),
        ),
        patch(
            "uniffy.domains.agents.runtime.runs.records.check_and_fire_alerts",
            alert,
        ),
    ):
        await RunRecorder(session).record(
            session_id=None,
            channel_id=generate_id(),
            agent_id=generate_id(),
            user_id=generate_id(),
            organization_id=organization_id,
            model="claude-sonnet-4-6",
            provider_key_id=primary_key_id,
            usage=usage,
            tool_calls=[{"name": "notes.search"}],
            tool_iterations=1,
            duration_ms=321,
            status=AgentRunStatus.SUCCESS,
            error=None,
        )

    row = session.add.call_args.args[0]
    assert row.model == "gpt-5.6-luna"
    assert row.provider_key_id == fallback_key_id
    assert row.input_tokens == 100
    assert row.output_tokens == 20
    assert row.cache_creation_input_tokens == 10
    assert row.cache_read_input_tokens == 5
    assert row.thinking_tokens == 3
    assert row.retry_count == 1
    assert row.failover_provider_key_ids == [str(fallback_key_id)]
    assert row.deadline_exceeded is True
    assert row.cost == Decimal("0.420000")
    assert row.cost_currency == "EUR"
    assert row.status == AgentRunStatus.SUCCESS
    assert row.tool_calls == [{"name": "notes.search"}]
    assert row.tool_iterations == 1
    assert row.duration_ms == 321
    session.commit.assert_awaited_once()
    alert.assert_awaited_once_with(
        session,
        organization_id=organization_id,
        run_cost=Decimal("0.420000"),
        run_image_count=0,
    )


async def test_error_record_keeps_fallback_identifiers_without_usage() -> None:
    session = _session()
    provider_key_id = generate_id()
    usage = RunUsageAccumulator()

    with (
        patch.object(RunRecorder, "_compute_cost", AsyncMock(return_value=(None, None))),
        patch(
            "uniffy.domains.agents.runtime.runs.records.check_and_fire_alerts",
            AsyncMock(),
        ) as alert,
    ):
        await RunRecorder(session).record(
            session_id=generate_id(),
            agent_id=generate_id(),
            user_id=generate_id(),
            organization_id=generate_id(),
            model="model-before-call",
            provider_key_id=provider_key_id,
            usage=usage,
            tool_calls=None,
            tool_iterations=0,
            duration_ms=50,
            status=AgentRunStatus.ERROR,
            error="No response from LLM",
        )

    row = session.add.call_args.args[0]
    assert row.model == "model-before-call"
    assert row.provider_key_id == provider_key_id
    assert row.status == AgentRunStatus.ERROR
    assert row.error == "No response from LLM"
    assert row.cost is None
    assert row.cost_currency is None
    alert.assert_not_awaited()


async def test_pricing_or_conversion_failure_does_not_drop_usage_record() -> None:
    session = _session()
    usage = _usage()

    with (
        patch(
            "uniffy.domains.agents.runtime.runs.records.get_display_currency",
            AsyncMock(return_value="EUR"),
        ),
        patch(
            "uniffy.domains.agents.runtime.runs.records.convert_currency",
            AsyncMock(side_effect=ValidationError("currency", "unavailable")),
        ),
        patch(
            "uniffy.domains.agents.runtime.runs.records.check_and_fire_alerts",
            AsyncMock(),
        ) as alert,
    ):
        await RunRecorder(session).record(
            session_id=generate_id(),
            agent_id=generate_id(),
            user_id=generate_id(),
            organization_id=generate_id(),
            model="gpt-5.6-luna",
            usage=usage,
            tool_calls=None,
            tool_iterations=0,
            duration_ms=10,
            status=AgentRunStatus.SUCCESS,
            error=None,
        )

    row = session.add.call_args.args[0]
    assert row.input_tokens == 100
    assert row.cost is None
    assert row.cost_currency is None
    session.commit.assert_awaited_once()
    alert.assert_not_awaited()


async def test_incomplete_pricing_skips_currency_lookup_and_alerts() -> None:
    session = _session()
    usage = _usage(model="unknown-model")
    display_currency = AsyncMock()
    alert = AsyncMock()

    with (
        patch(
            "uniffy.domains.agents.runtime.runs.records.get_display_currency",
            display_currency,
        ),
        patch(
            "uniffy.domains.agents.runtime.runs.records.check_and_fire_alerts",
            alert,
        ),
    ):
        await RunRecorder(session).record(
            session_id=generate_id(),
            agent_id=generate_id(),
            user_id=generate_id(),
            organization_id=generate_id(),
            model="unknown-model",
            usage=usage,
            tool_calls=None,
            tool_iterations=0,
            duration_ms=10,
            status=AgentRunStatus.SUCCESS,
            error=None,
        )

    row = session.add.call_args.args[0]
    assert row.input_tokens == 100
    assert row.cost is None
    assert row.cost_currency is None
    display_currency.assert_not_awaited()
    alert.assert_not_awaited()


async def test_persistence_failure_is_fail_open_and_skips_alerts() -> None:
    session = _session()
    session.commit.side_effect = RuntimeError("database unavailable")
    alert = AsyncMock()

    with (
        patch.object(RunRecorder, "_compute_cost", AsyncMock(return_value=(Decimal("1"), "USD"))),
        patch(
            "uniffy.domains.agents.runtime.runs.records.check_and_fire_alerts",
            alert,
        ),
    ):
        await RunRecorder(session).record(
            session_id=generate_id(),
            agent_id=generate_id(),
            user_id=generate_id(),
            organization_id=generate_id(),
            model="gpt-5.6-luna",
            usage=_usage(),
            tool_calls=None,
            tool_iterations=0,
            duration_ms=10,
            status=AgentRunStatus.SUCCESS,
            error=None,
        )

    alert.assert_not_awaited()


async def test_alert_failure_propagates_after_the_record_commits() -> None:
    session = _session()

    with (
        patch.object(RunRecorder, "_compute_cost", AsyncMock(return_value=(Decimal("1"), "USD"))),
        patch(
            "uniffy.domains.agents.runtime.runs.records.check_and_fire_alerts",
            AsyncMock(side_effect=RuntimeError("alert failed")),
        ),
        pytest.raises(RuntimeError, match="alert failed"),
    ):
        await RunRecorder(session).record(
            session_id=generate_id(),
            agent_id=generate_id(),
            user_id=generate_id(),
            organization_id=generate_id(),
            model="gpt-5.6-luna",
            usage=_usage(),
            tool_calls=None,
            tool_iterations=0,
            duration_ms=10,
            status=AgentRunStatus.SUCCESS,
            error=None,
        )

    session.commit.assert_awaited_once()
