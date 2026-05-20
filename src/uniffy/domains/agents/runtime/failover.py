"""Provider failover primitives for the agent runtime.

Three independent pieces:

- ``CircuitBreaker`` -- a process-local rolling-window breaker keyed
  on ``provider_key_id``. Opens after ``OPEN_THRESHOLD`` failures
  inside ``ROLLING_WINDOW_SECONDS`` and stays open for
  ``COOLDOWN_SECONDS`` so we stop hammering a key that just blew up.
- ``is_retryable_error`` -- classifier that decides whether a raised
  exception warrants a failover swap. 5xx / 408 / 504 / TimeoutError /
  ConnectionError are retryable; 429 (rate limit), auth failures, and
  other 4xx bodies are not (they will not get better on a sibling
  key).
- ``iter_failover_candidates`` -- async generator that yields the
  ordered list of fallback ``(provider, model, provider_key_id)``
  triples for a given run. Two layers, capped at
  ``MAX_FAILOVER_ATTEMPTS``: first the sibling enabled keys for the
  same provider (same model, just different credential), then any
  agent-configured ``fallback_models`` resolved through
  ``ProviderOperations``.

The breaker state and rolling-window samples live on the running
process. Pod restarts reset the breaker; that is acceptable -- a
genuinely-broken key will reopen the breaker within ROLLING_WINDOW
seconds of the next request that lands on it.
"""

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


OPEN_THRESHOLD = 3
ROLLING_WINDOW_SECONDS = 60.0
COOLDOWN_SECONDS = 30.0
MAX_FAILOVER_ATTEMPTS = 3


@dataclass
class _BreakerState:
    """Per-key rolling-window state."""

    failures: deque[float] = field(default_factory=deque)
    opened_at: float | None = None


class CircuitBreaker:
    """Process-local circuit breaker keyed on ``provider_key_id``.

    The breaker is intentionally simple. Failures inside the rolling
    window count up; once the count reaches ``OPEN_THRESHOLD`` the
    breaker opens and stays open for ``COOLDOWN_SECONDS``. After the
    cooldown a single successful call closes the breaker; another
    failure during cooldown re-opens it for a fresh ``COOLDOWN_SECONDS``.
    """

    def __init__(self) -> None:
        self._state: dict[str, _BreakerState] = defaultdict(_BreakerState)

    def _key(self, provider_key_id: UUID | str | None) -> str:
        return str(provider_key_id) if provider_key_id else "<no-key>"

    def is_open(self, provider_key_id: UUID | str | None) -> bool:
        """Return True if the breaker for this key is currently open."""
        state = self._state.get(self._key(provider_key_id))
        if state is None or state.opened_at is None:
            return False
        if time.monotonic() - state.opened_at >= COOLDOWN_SECONDS:
            state.opened_at = None
            state.failures.clear()
            return False
        return True

    def record_failure(self, provider_key_id: UUID | str | None) -> None:
        """Record a failure; open the breaker if the threshold is reached."""
        state = self._state[self._key(provider_key_id)]
        now = time.monotonic()
        state.failures.append(now)
        cutoff = now - ROLLING_WINDOW_SECONDS
        while state.failures and state.failures[0] < cutoff:
            state.failures.popleft()
        if len(state.failures) >= OPEN_THRESHOLD:
            state.opened_at = now

    def record_success(self, provider_key_id: UUID | str | None) -> None:
        """Reset the rolling window and close the breaker on success."""
        state = self._state.get(self._key(provider_key_id))
        if state is None:
            return
        state.failures.clear()
        state.opened_at = None

    def reset(self, provider_key_id: UUID | str | None = None) -> None:
        """Drop all state for one key, or every key when ``None``."""
        if provider_key_id is None:
            self._state.clear()
            return
        self._state.pop(self._key(provider_key_id), None)


_breaker = CircuitBreaker()


def get_breaker() -> CircuitBreaker:
    """Return the process-singleton breaker instance."""
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
    """Map an HTTP status code to a retry reason, or ``None`` if not retryable."""
    if status_code in (408, 504):
        return "timeout"
    if 500 <= status_code <= 599:
        return "5xx"
    return None


def is_retryable_error(exc: BaseException) -> tuple[bool, str]:
    """Classify ``exc`` for failover.

    Returns ``(retryable, reason)``. ``reason`` is a short tag used in
    ``RuntimeFailoverEvent`` ("timeout" / "5xx" / "connection" /
    "other") and surfaces in metrics. A False return means the next
    attempt would not have helped (rate limit, auth, malformed
    request); the runtime should give up and emit an Error event.
    """
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
    """A concrete fallback target for a single retry attempt."""

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
) -> AsyncIterator[FailoverCandidate]:
    """Yield up to ``MAX_FAILOVER_ATTEMPTS`` ordered fallbacks.

    Order:
    1. Sibling keys on the same provider (same model, fresh
       credential). Skips the primary key and any key whose breaker
       is open.
    2. Each ``fallback_models`` entry resolved through
       ``ProviderOperations.get_provider_for_model``. Cross-provider
       failover.

    Stops as soon as ``MAX_FAILOVER_ATTEMPTS`` candidates have been
    yielded.
    """
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
        if breaker.is_open(key.id):
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
        if breaker.is_open(key.id):
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
