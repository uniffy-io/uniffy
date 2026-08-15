"""Tests for the provider-failover primitives."""

from __future__ import annotations

import time
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest

import uniffy.domains.auth  # noqa: F401  -- pre-import auth chain
from uniffy.core.types import generate_id
from uniffy.domains.agents.runtime import failover as failover_mod
from uniffy.domains.agents.runtime.failover import (
    COOLDOWN_SECONDS,
    MAX_FAILOVER_ATTEMPTS,
    OPEN_THRESHOLD,
    CircuitBreaker,
    is_retryable_error,
    iter_failover_candidates,
)


class _FakeException(Exception):
    """Exception with a settable status_code for classifier tests."""

    def __init__(self, status_code: int) -> None:
        super().__init__(f"http {status_code}")
        self.status_code = status_code


class TestCircuitBreaker:
    def test_clean_breaker_is_closed(self) -> None:
        breaker = CircuitBreaker()
        assert breaker.is_open(generate_id()) is False

    def test_opens_after_threshold_failures(self) -> None:
        breaker = CircuitBreaker()
        key = generate_id()
        for _ in range(OPEN_THRESHOLD):
            breaker.record_failure(key)
        assert breaker.is_open(key) is True

    def test_success_resets_breaker(self) -> None:
        breaker = CircuitBreaker()
        key = generate_id()
        for _ in range(OPEN_THRESHOLD):
            breaker.record_failure(key)
        assert breaker.is_open(key) is True
        breaker.record_success(key)
        assert breaker.is_open(key) is False

    def test_recovery_after_cooldown(self, monkeypatch: pytest.MonkeyPatch) -> None:
        breaker = CircuitBreaker()
        key = generate_id()
        base = time.monotonic()
        timeline = {"now": base}

        def fake_monotonic() -> float:
            return timeline["now"]

        monkeypatch.setattr(failover_mod.time, "monotonic", fake_monotonic)

        for _ in range(OPEN_THRESHOLD):
            breaker.record_failure(key)
        assert breaker.is_open(key) is True

        timeline["now"] = base + COOLDOWN_SECONDS + 1
        assert breaker.is_open(key) is False

    def test_per_key_isolation(self) -> None:
        breaker = CircuitBreaker()
        a = generate_id()
        b = generate_id()
        for _ in range(OPEN_THRESHOLD):
            breaker.record_failure(a)
        assert breaker.is_open(a) is True
        assert breaker.is_open(b) is False

    def test_reset_specific_key(self) -> None:
        breaker = CircuitBreaker()
        a = generate_id()
        b = generate_id()
        for _ in range(OPEN_THRESHOLD):
            breaker.record_failure(a)
            breaker.record_failure(b)
        breaker.reset(a)
        assert breaker.is_open(a) is False
        assert breaker.is_open(b) is True


class TestRetryableClassification:
    def test_5xx_status_codes_retryable(self) -> None:
        ok, reason = is_retryable_error(_FakeException(503))
        assert ok is True
        assert reason == "5xx"

    def test_429_not_retryable(self) -> None:
        ok, _ = is_retryable_error(_FakeException(429))
        assert ok is False

    def test_4xx_other_than_408_504_not_retryable(self) -> None:
        for code in (400, 401, 403, 404, 422):
            ok, _ = is_retryable_error(_FakeException(code))
            assert ok is False, f"{code} unexpectedly retryable"

    def test_408_request_timeout_retryable(self) -> None:
        ok, reason = is_retryable_error(_FakeException(408))
        assert ok is True
        assert reason == "timeout"

    def test_504_gateway_timeout_retryable(self) -> None:
        ok, reason = is_retryable_error(_FakeException(504))
        assert ok is True
        assert reason == "timeout"

    def test_named_provider_errors(self) -> None:
        class APIConnectionError(Exception):
            pass

        ok, reason = is_retryable_error(APIConnectionError("boom"))
        assert ok is True
        assert reason == "5xx"

    def test_builtin_timeout_and_connection_errors_retryable(self) -> None:
        ok_t, reason_t = is_retryable_error(TimeoutError("slow"))
        assert ok_t is True
        assert reason_t == "timeout"
        ok_c, reason_c = is_retryable_error(ConnectionError("dropped"))
        assert ok_c is True
        assert reason_c == "connection"

    def test_unknown_exception_not_retryable_by_default(self) -> None:
        ok, reason = is_retryable_error(ValueError("bad input"))
        assert ok is False
        assert reason == "other"

    def test_response_attr_status_code(self) -> None:
        class WrappedResp:
            status_code = 502

        class APIError(Exception):
            response = WrappedResp()

        ok, reason = is_retryable_error(APIError())
        assert ok is True
        assert reason == "5xx"


def _make_key(*, key_id: UUID | None = None, provider: str = "anthropic") -> MagicMock:
    """Build a fake ProviderKey-shaped object for the iterator tests."""
    key = MagicMock()
    key.id = key_id or generate_id()
    key.provider = provider
    return key


def _make_provider_ops(
    *,
    siblings: list[MagicMock],
    fallback_resolver: dict[str, tuple[MagicMock, MagicMock] | None] | None = None,
) -> MagicMock:
    """Build a fake ProviderOperations exposing the two helpers the iterator uses."""
    ops = MagicMock()
    ops.list_enabled_keys_for_provider = AsyncMock(return_value=siblings)

    async def _resolve(*, organization_id, model_id):  # noqa: ARG001
        if fallback_resolver is None:
            return None
        return fallback_resolver.get(model_id)

    async def _by_key(*, organization_id, key_id):  # noqa: ARG001
        match = next((k for k in siblings if k.id == key_id), MagicMock())
        return MagicMock(name="provider_for_key"), match

    ops.get_key_and_provider_for_model = AsyncMock(side_effect=_resolve)
    ops.get_provider_for_key = AsyncMock(side_effect=_by_key)
    return ops


class TestCandidateIterator:
    async def test_yields_siblings_then_fallbacks(self) -> None:
        org_id = generate_id()
        primary_key = _make_key(provider="anthropic")
        sibling_a = _make_key(provider="anthropic")
        sibling_b = _make_key(provider="anthropic")

        fallback_provider = MagicMock(name="openai_provider")
        fallback_key = _make_key(provider="openai")

        ops = _make_provider_ops(
            siblings=[primary_key, sibling_a, sibling_b],
            fallback_resolver={"gpt-4o-mini": (fallback_provider, fallback_key)},
        )

        async def collect() -> list:
            out = []
            async for c in iter_failover_candidates(
                provider_ops=ops,
                organization_id=org_id,
                primary_provider_name="anthropic",
                primary_provider_key_id=primary_key.id,
                primary_model="claude-sonnet",
                fallback_models=["gpt-4o-mini"],
                breaker=CircuitBreaker(),
            ):
                out.append(c)
            return out

        candidates = await collect()
        assert len(candidates) == 3
        assert {c.provider_key_id for c in candidates[:2]} == {
            sibling_a.id,
            sibling_b.id,
        }
        assert candidates[-1].model == "gpt-4o-mini"
        assert candidates[-1].provider_key_id == fallback_key.id

    async def test_caps_at_max_attempts(self) -> None:
        org_id = generate_id()
        primary_key = _make_key(provider="anthropic")
        siblings = [primary_key] + [_make_key(provider="anthropic") for _ in range(5)]
        ops = _make_provider_ops(siblings=siblings)

        async def collect() -> list:
            out = []
            async for c in iter_failover_candidates(
                provider_ops=ops,
                organization_id=org_id,
                primary_provider_name="anthropic",
                primary_provider_key_id=primary_key.id,
                primary_model="claude-sonnet",
                fallback_models=[],
                breaker=CircuitBreaker(),
            ):
                out.append(c)
            return out

        candidates = await collect()
        assert len(candidates) == MAX_FAILOVER_ATTEMPTS

    async def test_skips_open_breaker_keys(self) -> None:
        org_id = generate_id()
        primary_key = _make_key(provider="anthropic")
        bad_sibling = _make_key(provider="anthropic")
        good_sibling = _make_key(provider="anthropic")

        breaker = CircuitBreaker()
        for _ in range(OPEN_THRESHOLD):
            breaker.record_failure(bad_sibling.id)

        ops = _make_provider_ops(siblings=[primary_key, bad_sibling, good_sibling])

        async def collect() -> list:
            out = []
            async for c in iter_failover_candidates(
                provider_ops=ops,
                organization_id=org_id,
                primary_provider_name="anthropic",
                primary_provider_key_id=primary_key.id,
                primary_model="claude-sonnet",
                fallback_models=[],
                breaker=breaker,
            ):
                out.append(c)
            return out

        candidates = await collect()
        assert len(candidates) == 1
        assert candidates[0].provider_key_id == good_sibling.id

    async def test_no_fallback_when_resolver_returns_none(self) -> None:
        org_id = generate_id()
        primary_key = _make_key(provider="anthropic")

        ops = _make_provider_ops(
            siblings=[primary_key],
            fallback_resolver={"gpt-4o": None},
        )

        async def collect() -> list:
            out = []
            async for c in iter_failover_candidates(
                provider_ops=ops,
                organization_id=org_id,
                primary_provider_name="anthropic",
                primary_provider_key_id=primary_key.id,
                primary_model="claude-sonnet",
                fallback_models=["gpt-4o"],
                breaker=CircuitBreaker(),
            ):
                out.append(c)
            return out

        candidates = await collect()
        assert candidates == []
