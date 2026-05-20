"""Runtime settings loader with a small in-process cache.

Reads ``agents_runtime_settings`` rows by ``organization_id``. Missing
rows fall through to module-level defaults from
``core.models.agents.runtime_settings``. Failures are swallowed so a
broken DB or missing column never blocks a send.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.agents.runtime_settings import (
    DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
    DEFAULT_CIRCUIT_BREAKER_RECOVERY_SECONDS,
    DEFAULT_SEND_DEADLINE_SECONDS,
    AgentRuntimeSettings,
)


@dataclass(frozen=True)
class ResolvedRuntimeSettings:
    """Effective runtime settings for an organization."""

    send_deadline_seconds: int
    failover_enabled: bool
    resume_enabled: bool
    circuit_breaker_failure_threshold: int
    circuit_breaker_recovery_seconds: int


_CACHE_TTL_SECONDS = 30.0
_cache: dict[UUID, tuple[float, ResolvedRuntimeSettings]] = {}


def _defaults() -> ResolvedRuntimeSettings:
    return ResolvedRuntimeSettings(
        send_deadline_seconds=DEFAULT_SEND_DEADLINE_SECONDS,
        failover_enabled=True,
        resume_enabled=True,
        circuit_breaker_failure_threshold=DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
        circuit_breaker_recovery_seconds=DEFAULT_CIRCUIT_BREAKER_RECOVERY_SECONDS,
    )


async def get_runtime_settings(
    session: AsyncSession,
    organization_id: UUID,
) -> ResolvedRuntimeSettings:
    """Resolve runtime settings for ``organization_id`` (cached)."""
    cached = _cache.get(organization_id)
    if cached is not None:
        ts, value = cached
        if time.monotonic() - ts < _CACHE_TTL_SECONDS:
            return value

    try:
        result = await session.execute(
            select(AgentRuntimeSettings).where(
                AgentRuntimeSettings.organization_id == organization_id
            )
        )
        row = result.scalar_one_or_none()
    except Exception:
        logger.warning("Failed to load runtime settings; using defaults", exc_info=True)
        return _defaults()

    if row is None:
        resolved = _defaults()
    else:
        resolved = ResolvedRuntimeSettings(
            send_deadline_seconds=row.send_deadline_seconds or DEFAULT_SEND_DEADLINE_SECONDS,
            failover_enabled=row.failover_enabled,
            resume_enabled=row.resume_enabled,
            circuit_breaker_failure_threshold=row.circuit_breaker_failure_threshold,
            circuit_breaker_recovery_seconds=row.circuit_breaker_recovery_seconds,
        )

    _cache[organization_id] = (time.monotonic(), resolved)
    return resolved


def invalidate_runtime_settings_cache(organization_id: UUID | None = None) -> None:
    """Drop one org's cached settings (or all when ``None``)."""
    if organization_id is None:
        _cache.clear()
    else:
        _cache.pop(organization_id, None)
