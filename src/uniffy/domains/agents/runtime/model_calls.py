"""Deadline, failover, and accounting controls for runtime model calls."""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from uniffy.domains.agents.providers.base import (
    CompletionResult,
    LLMProvider,
    StreamEvent,
    ensure_visible_terminal,
)
from uniffy.domains.agents.runtime.failover import (
    CircuitBreaker,
    FailoverCandidate,
    get_breaker,
    is_retryable_error,
    iter_failover_candidates,
)
from uniffy.domains.agents.runtime.run_usage import RunUsageAccumulator
from uniffy.domains.agents.runtime.settings import ResolvedRuntimeSettings


@dataclass(slots=True)
class ModelCallTarget:
    provider: LLMProvider
    provider_key_id: UUID | None
    model: str

    @property
    def provider_name(self) -> str:
        return getattr(self.provider, "name", type(self.provider).__name__.lower())


@dataclass(frozen=True, slots=True)
class FailoverTransition:
    from_provider_key_id: UUID | None
    to_provider_key_id: UUID | None
    to_model: str
    reason: str
    attempt: int


class CircuitOpenError(ConnectionError):
    pass


class ModelCallController:
    def __init__(
        self,
        *,
        provider_ops: Any,
        organization_id: UUID,
        target: ModelCallTarget,
        fallback_models: list[str],
        settings: ResolvedRuntimeSettings,
        usage: RunUsageAccumulator,
        params_for_target: Callable[[str, str], dict | None],
        breaker: CircuitBreaker | None = None,
    ) -> None:
        self._provider_ops = provider_ops
        self._organization_id = organization_id
        self.target = target
        self._primary = ModelCallTarget(
            provider=target.provider,
            provider_key_id=target.provider_key_id,
            model=target.model,
        )
        self._fallback_models = fallback_models
        self._settings = settings
        self._usage = usage
        self._params_for_target = params_for_target
        self._breaker = breaker or get_breaker()
        self._deadline_at = time.monotonic() + settings.send_deadline_seconds
        self._candidate_iter: AsyncIterator[FailoverCandidate] | None = None
        self._attempted = {(target.provider_key_id, target.model)}
        self._failover_attempt = 0

    def remaining_seconds(self) -> float:
        remaining = self._deadline_at - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("agent send deadline exceeded")
        return remaining

    def request_params(self) -> dict | None:
        return self._params_for_target(self.target.provider_name, self.target.model)

    async def complete(
        self,
        *,
        messages: list[dict],
        system: str | None,
        tools: list[dict] | None,
        cache_key: str,
        safety_identifier: str | None = None,
    ) -> CompletionResult:
        await self._skip_open_primary()
        while True:
            try:
                async with asyncio.timeout(self.remaining_seconds()):
                    result = await self.target.provider.chat_completion(
                        messages=messages,
                        model=self.target.model,
                        system=system,
                        tools=tools,
                        cache_key=cache_key,
                        params=self.request_params(),
                        safety_identifier=safety_identifier,
                    )
                if not isinstance(result, CompletionResult):
                    raise TypeError("provider returned a stream for a non-streaming call")
            except Exception as exc:
                transition = await self.record_failure_and_failover(exc)
                if transition is None:
                    raise
                continue
            result = ensure_visible_terminal(result)
            self.record_result(result)
            return result

    async def open_stream(
        self,
        *,
        messages: list[dict],
        system: str | None,
        tools: list[dict] | None,
        cache_key: str,
        safety_identifier: str | None = None,
    ) -> tuple[AsyncIterator[StreamEvent], list[FailoverTransition]]:
        transitions = await self._skip_open_primary()
        async with asyncio.timeout(self.remaining_seconds()):
            stream = await self.target.provider.chat_completion(
                messages=messages,
                model=self.target.model,
                system=system,
                tools=tools,
                stream=True,
                cache_key=cache_key,
                params=self.request_params(),
                safety_identifier=safety_identifier,
            )
        if isinstance(stream, CompletionResult):
            raise TypeError("provider returned a completion for a streaming call")
        return stream, transitions

    def record_result(self, result: CompletionResult) -> None:
        ensure_visible_terminal(result)
        self._breaker.record_success(self.target.provider_key_id)
        self._usage.record_result(
            provider=self.target.provider_name,
            provider_key_id=self.target.provider_key_id,
            result=result,
            model=self.target.model,
        )

    async def record_failure_and_failover(
        self,
        exc: BaseException,
        *,
        allow_failover: bool = True,
    ) -> FailoverTransition | None:
        retryable, reason = is_retryable_error(exc)
        self._usage.record_failure(
            provider=self.target.provider_name,
            provider_key_id=self.target.provider_key_id,
            model=self.target.model,
            error=type(exc).__name__,
        )
        if retryable:
            self._breaker.record_failure(
                self.target.provider_key_id,
                threshold=self._settings.circuit_breaker_failure_threshold,
            )
        if not allow_failover or not retryable or not self._settings.failover_enabled:
            return None
        try:
            return await self._next_target(reason)
        except TimeoutError:
            return None

    async def _skip_open_primary(self) -> list[FailoverTransition]:
        if not self._breaker.is_open(
            self.target.provider_key_id,
            recovery_seconds=self._settings.circuit_breaker_recovery_seconds,
        ):
            return []
        self._usage.record_failure(
            provider=self.target.provider_name,
            provider_key_id=self.target.provider_key_id,
            model=self.target.model,
            error="circuit_open",
        )
        if not self._settings.failover_enabled:
            raise CircuitOpenError("provider circuit is open")
        transition = await self._next_target("circuit_open")
        if transition is None:
            raise CircuitOpenError("provider circuit is open")
        return [transition]

    async def _next_target(self, reason: str) -> FailoverTransition | None:
        if self._candidate_iter is None:
            self._candidate_iter = iter_failover_candidates(
                provider_ops=self._provider_ops,
                organization_id=self._organization_id,
                primary_provider_name=self._primary.provider_name,
                primary_provider_key_id=self._primary.provider_key_id,
                primary_model=self._primary.model,
                fallback_models=self._fallback_models,
                breaker=self._breaker,
                recovery_seconds=self._settings.circuit_breaker_recovery_seconds,
            )

        while True:
            try:
                async with asyncio.timeout(self.remaining_seconds()):
                    candidate = await anext(self._candidate_iter)
            except StopAsyncIteration:
                return None
            marker = (candidate.provider_key_id, candidate.model)
            if marker in self._attempted:
                continue
            self._attempted.add(marker)
            previous_key = self.target.provider_key_id
            self.target.provider = candidate.provider
            self.target.provider_key_id = candidate.provider_key_id
            self.target.model = candidate.model
            self._failover_attempt += 1
            return FailoverTransition(
                from_provider_key_id=previous_key,
                to_provider_key_id=candidate.provider_key_id,
                to_model=candidate.model,
                reason=reason,
                attempt=self._failover_attempt,
            )
