from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.types import generate_id
from uniffy.domains.agents.providers.base import CompletionResult
from uniffy.domains.agents.runtime.failover import CircuitBreaker
from uniffy.domains.agents.runtime.model_calls import (
    ModelCallController,
    ModelCallTarget,
)
from uniffy.domains.agents.runtime.run_usage import RunUsageAccumulator
from uniffy.domains.agents.runtime.settings import ResolvedRuntimeSettings


class _Provider:
    def __init__(self, name: str, results: list[object]) -> None:
        self.name = name
        self._results = list(results)
        self.requests: list[dict] = []

    async def chat_completion(self, **kwargs):
        self.requests.append(kwargs)
        result = self._results.pop(0)
        if isinstance(result, BaseException):
            raise result
        return result


class _HttpError(Exception):
    status_code = 503


def _settings(**overrides) -> ResolvedRuntimeSettings:
    values = {
        "send_deadline_seconds": 30,
        "failover_enabled": True,
        "resume_enabled": True,
        "circuit_breaker_failure_threshold": 5,
        "circuit_breaker_recovery_seconds": 60,
        "display_currency": "USD",
        "personal_memory_bridge_enabled": True,
        "default_provider_key_id": None,
        "default_chat_model": None,
        "image_max_resolution": None,
        "image_max_quality": None,
    }
    values.update(overrides)
    return ResolvedRuntimeSettings(**values)


def _key(key_id, provider: str):
    return MagicMock(id=key_id, provider=provider)


def _controller(
    *,
    primary: _Provider,
    primary_key_id,
    provider_ops,
    usage: RunUsageAccumulator,
    settings: ResolvedRuntimeSettings | None = None,
    breaker: CircuitBreaker | None = None,
) -> ModelCallController:
    return ModelCallController(
        provider_ops=provider_ops,
        organization_id=generate_id(),
        target=ModelCallTarget(
            provider=primary,
            provider_key_id=primary_key_id,
            model="primary-model",
        ),
        fallback_models=[],
        settings=settings or _settings(),
        usage=usage,
        params_for_target=lambda provider, model: {
            "provider": provider,
            "model": model,
        },
        breaker=breaker,
    )


async def test_retryable_failure_switches_key_and_accounts_each_attempt() -> None:
    primary_key_id = generate_id()
    fallback_key_id = generate_id()
    primary = _Provider("openai", [_HttpError("unavailable")])
    fallback = _Provider(
        "openai",
        [CompletionResult(content="ok", model="primary-model", input_tokens=10)],
    )
    provider_ops = MagicMock()
    provider_ops.list_enabled_keys_for_provider = AsyncMock(
        return_value=[
            _key(primary_key_id, "openai"),
            _key(fallback_key_id, "openai"),
        ]
    )
    provider_ops.get_provider_for_key = AsyncMock(
        return_value=(fallback, _key(fallback_key_id, "openai"))
    )
    usage = RunUsageAccumulator()
    controller = _controller(
        primary=primary,
        primary_key_id=primary_key_id,
        provider_ops=provider_ops,
        usage=usage,
    )

    result = await controller.complete(
        messages=[],
        system=None,
        tools=None,
        cache_key="agent",
        safety_identifier="hashed-user",
    )

    assert result.content == "ok"
    assert [call.status for call in usage.calls] == ["error", "success"]
    assert usage.failover_provider_key_ids == [str(fallback_key_id)]
    assert fallback.requests[0]["safety_identifier"] == "hashed-user"
    assert fallback.requests[0]["params"]["provider"] == "openai"


async def test_non_retryable_failure_does_not_try_a_sibling() -> None:
    primary_key_id = generate_id()
    primary = _Provider("openai", [ValueError("invalid request")])
    provider_ops = MagicMock()
    provider_ops.list_enabled_keys_for_provider = AsyncMock(return_value=[])
    usage = RunUsageAccumulator()
    controller = _controller(
        primary=primary,
        primary_key_id=primary_key_id,
        provider_ops=provider_ops,
        usage=usage,
    )

    with pytest.raises(ValueError):
        await controller.complete(
            messages=[],
            system=None,
            tools=None,
            cache_key="agent",
        )

    provider_ops.list_enabled_keys_for_provider.assert_not_awaited()
    assert usage.retry_count == 1


async def test_configured_threshold_opens_the_breaker() -> None:
    primary_key_id = generate_id()
    primary = _Provider("openai", [_HttpError("unavailable")])
    provider_ops = MagicMock()
    usage = RunUsageAccumulator()
    breaker = CircuitBreaker()
    controller = _controller(
        primary=primary,
        primary_key_id=primary_key_id,
        provider_ops=provider_ops,
        usage=usage,
        settings=_settings(
            circuit_breaker_failure_threshold=1,
            failover_enabled=False,
        ),
        breaker=breaker,
    )

    with pytest.raises(_HttpError):
        await controller.complete(
            messages=[],
            system=None,
            tools=None,
            cache_key="agent",
        )

    assert breaker.is_open(primary_key_id) is True
