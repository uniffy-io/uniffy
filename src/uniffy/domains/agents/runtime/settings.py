"""Per-org agent runtime settings, backed by the generic ``org_settings`` store.

Stored as one JSON blob under ``namespace='agents'``, ``key='runtime'``. A missing
row (or a broken read) falls through to module defaults so a config hiccup never
blocks a send. A small in-process cache keeps the hot pre-flight read cheap.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from uuid import UUID

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.domains.org_settings.operations import OrgSettingsOperations

logger = logger.bind(component="agents.runtime.settings")

AGENTS_NAMESPACE = "agents"
RUNTIME_KEY = "runtime"

DEFAULT_SEND_DEADLINE_SECONDS = 300
DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5
DEFAULT_CIRCUIT_BREAKER_RECOVERY_SECONDS = 60
DEFAULT_DISPLAY_CURRENCY = "USD"


@dataclass(frozen=True)
class ResolvedRuntimeSettings:
    """Effective runtime settings for an organization."""

    send_deadline_seconds: int
    failover_enabled: bool
    resume_enabled: bool
    circuit_breaker_failure_threshold: int
    circuit_breaker_recovery_seconds: int
    display_currency: str


_CACHE_TTL_SECONDS = 30.0
_cache: dict[UUID, tuple[float, ResolvedRuntimeSettings]] = {}


def _defaults() -> ResolvedRuntimeSettings:
    return ResolvedRuntimeSettings(
        send_deadline_seconds=DEFAULT_SEND_DEADLINE_SECONDS,
        failover_enabled=True,
        resume_enabled=True,
        circuit_breaker_failure_threshold=DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
        circuit_breaker_recovery_seconds=DEFAULT_CIRCUIT_BREAKER_RECOVERY_SECONDS,
        display_currency=DEFAULT_DISPLAY_CURRENCY,
    )


def _from_blob(blob: dict) -> ResolvedRuntimeSettings:
    deadline = blob.get("send_deadline_seconds")
    return ResolvedRuntimeSettings(
        send_deadline_seconds=int(deadline) if deadline else DEFAULT_SEND_DEADLINE_SECONDS,
        failover_enabled=bool(blob.get("failover_enabled", True)),
        resume_enabled=bool(blob.get("resume_enabled", True)),
        circuit_breaker_failure_threshold=int(
            blob.get("circuit_breaker_failure_threshold", DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD)
        ),
        circuit_breaker_recovery_seconds=int(
            blob.get("circuit_breaker_recovery_seconds", DEFAULT_CIRCUIT_BREAKER_RECOVERY_SECONDS)
        ),
        display_currency=str(blob.get("display_currency") or DEFAULT_DISPLAY_CURRENCY),
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
        rows = await OrgSettingsOperations(session).get_namespace(
            organization_id, AGENTS_NAMESPACE
        )
        row = rows.get(RUNTIME_KEY)
    except Exception:
        logger.opt(exception=True).warning("Failed to load runtime settings; using defaults")
        return _defaults()

    if row is None or not isinstance(row.value, dict):
        resolved = _defaults()
    else:
        resolved = _from_blob(row.value)

    _cache[organization_id] = (time.monotonic(), resolved)
    return resolved


def invalidate_runtime_settings_cache(organization_id: UUID | None = None) -> None:
    """Drop one org's cached settings (or all when ``None``)."""
    if organization_id is None:
        _cache.clear()
    else:
        _cache.pop(organization_id, None)
