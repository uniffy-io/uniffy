"""Provider failover primitives for the agent runtime."""

from __future__ import annotations

import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import TYPE_CHECKING
from uuid import UUID

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from uniffy.domains.agents.providers.base import LLMProvider
    from uniffy.domains.agents.providers.operations import ProviderOperations


OPEN_THRESHOLD = 5
ROLLING_WINDOW_SECONDS = 60.0
COOLDOWN_SECONDS = 60.0
MAX_FAILOVER_ATTEMPTS = 3


@dataclass
class _BreakerState:
    failures: deque[float] = field(default_factory=deque)
    opened_at: float | None = None


class CircuitBreaker:
    """Track retryable provider-key failures in a process-local rolling window."""

    def __init__(self) -> None:
        self._state: dict[str, _BreakerState] = defaultdict(_BreakerState)

    def _key(self, provider_key_id: UUID | str | None) -> str:
        return str(provider_key_id) if provider_key_id else "<no-key>"

    def is_open(
        self,
        provider_key_id: UUID | str | None,
        *,
        recovery_seconds: float = COOLDOWN_SECONDS,
    ) -> bool:
        state = self._state.get(self._key(provider_key_id))
        if state is None or state.opened_at is None:
            return False
        if time.monotonic() - state.opened_at >= recovery_seconds:
            state.opened_at = None
            state.failures.clear()
            return False
        return True

    def record_failure(
        self,
        provider_key_id: UUID | str | None,
        *,
        threshold: int = OPEN_THRESHOLD,
    ) -> None:
        state = self._state[self._key(provider_key_id)]
        now = time.monotonic()
        state.failures.append(now)
        cutoff = now - ROLLING_WINDOW_SECONDS
        while state.failures and state.failures[0] < cutoff:
            state.failures.popleft()
        if len(state.failures) >= max(1, threshold):
            state.opened_at = now

    def record_success(self, provider_key_id: UUID | str | None) -> None:
        state = self._state.get(self._key(provider_key_id))
        if state is None:
            return
        state.failures.clear()
        state.opened_at = None

    def reset(self, provider_key_id: UUID | str | None = None) -> None:
        if provider_key_id is None:
            self._state.clear()
            return
        self._state.pop(self._key(provider_key_id), None)


_breaker = CircuitBreaker()


def get_breaker() -> CircuitBreaker:
    return _breaker


_RETRYABLE_TYPE_NAMES = {
    "APIConnectionError",
    "APITimeoutError",
    "InternalServerError",
    "ServiceUnavailableError",
    "BadGatewayError",
    "GatewayTimeoutError",
}


def _classify_status(status_code: int) -> str | None:
    if status_code in (408, 504):
        return "timeout"
    if 500 <= status_code <= 599:
        return "5xx"
    return None


def is_retryable_error(exc: BaseException) -> tuple[bool, str]:
    """Retry transport/timeouts and 5xx failures, but not auth, rate-limit, or 4xx errors."""
    if isinstance(exc, TimeoutError):
        return True, "timeout"
    if isinstance(exc, ConnectionError):
        return True, "connection"

    status_code = getattr(exc, "status_code", None)
    if isinstance(status_code, int):
        reason = _classify_status(status_code)
        if reason is not None:
            return True, reason

    response = getattr(exc, "response", None)
    if response is not None:
        rsc = getattr(response, "status_code", None)
        if isinstance(rsc, int):
            reason = _classify_status(rsc)
            if reason is not None:
                return True, reason

    if exc.__class__.__name__ in _RETRYABLE_TYPE_NAMES:
        return True, "5xx"

    return False, "other"


@dataclass
class FailoverCandidate:
    provider: LLMProvider
    model: str
    provider_key_id: UUID | None
    provider_name: str


async def iter_failover_candidates(
    *,
    provider_ops: ProviderOperations,
    organization_id: UUID,
    primary_provider_name: str,
    primary_provider_key_id: UUID | None,
    primary_model: str,
    fallback_models: list[str],
    breaker: CircuitBreaker | None = None,
    recovery_seconds: float = COOLDOWN_SECONDS,
) -> AsyncIterator[FailoverCandidate]:
    """Yield sibling-key fallbacks before configured cross-provider models."""
    yielded = 0
    breaker = breaker or get_breaker()

    siblings = await provider_ops.list_enabled_keys_for_provider(
        organization_id=organization_id,
        provider=primary_provider_name,
    )
    for key in siblings:
        if yielded >= MAX_FAILOVER_ATTEMPTS:
            return
        if primary_provider_key_id is not None and key.id == primary_provider_key_id:
            continue
        if breaker.is_open(key.id, recovery_seconds=recovery_seconds):
            continue
        provider, _ = await provider_ops.get_provider_for_key(
            organization_id=organization_id,
            key_id=key.id,
        )
        yield FailoverCandidate(
            provider=provider,
            model=primary_model,
            provider_key_id=key.id,
            provider_name=key.provider,
        )
        yielded += 1

    for fallback_model in fallback_models:
        if yielded >= MAX_FAILOVER_ATTEMPTS:
            return
        try:
            candidate = await provider_ops.get_key_and_provider_for_model(
                organization_id=organization_id,
                model_id=fallback_model,
            )
        except Exception:
            continue
        if candidate is None:
            continue
        provider, key = candidate
        if breaker.is_open(key.id, recovery_seconds=recovery_seconds):
            continue
        if primary_provider_key_id is not None and key.id == primary_provider_key_id:
            continue
        yield FailoverCandidate(
            provider=provider,
            model=fallback_model,
            provider_key_id=key.id,
            provider_name=key.provider,
        )
        yielded += 1
