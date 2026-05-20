"""Tests for the per-org runtime settings loader and cache."""

import asyncio
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from uniffy.core.models.agents.runtime_settings import (
    DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
    DEFAULT_CIRCUIT_BREAKER_RECOVERY_SECONDS,
    DEFAULT_SEND_DEADLINE_SECONDS,
    AgentRuntimeSettings,
)
from uniffy.domains.agents.runtime.settings import (
    get_runtime_settings,
    invalidate_runtime_settings_cache,
)


def _session_returning(row: AgentRuntimeSettings | None) -> MagicMock:
    """Build a fake AsyncSession whose execute() yields a single row."""
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=row)

    session = MagicMock()
    session.execute = AsyncMock(return_value=result)
    return session


def test_missing_row_falls_back_to_module_defaults() -> None:
    async def run() -> None:
        invalidate_runtime_settings_cache()
        org_id = uuid4()
        session = _session_returning(None)

        resolved = await get_runtime_settings(session, org_id)

        assert resolved.send_deadline_seconds == DEFAULT_SEND_DEADLINE_SECONDS
        assert resolved.failover_enabled is True
        assert resolved.resume_enabled is True
        assert (
            resolved.circuit_breaker_failure_threshold
            == DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD
        )
        assert (
            resolved.circuit_breaker_recovery_seconds
            == DEFAULT_CIRCUIT_BREAKER_RECOVERY_SECONDS
        )

    asyncio.run(run())


def test_row_overrides_defaults_only_for_set_columns() -> None:
    async def run() -> None:
        invalidate_runtime_settings_cache()
        org_id = uuid4()
        row = AgentRuntimeSettings(
            organization_id=org_id,
            send_deadline_seconds=15,
            failover_enabled=False,
            resume_enabled=False,
            circuit_breaker_failure_threshold=2,
            circuit_breaker_recovery_seconds=5,
        )
        session = _session_returning(row)

        resolved = await get_runtime_settings(session, org_id)

        assert resolved.send_deadline_seconds == 15
        assert resolved.failover_enabled is False
        assert resolved.resume_enabled is False
        assert resolved.circuit_breaker_failure_threshold == 2
        assert resolved.circuit_breaker_recovery_seconds == 5

    asyncio.run(run())


def test_null_deadline_falls_back_to_module_default() -> None:
    async def run() -> None:
        invalidate_runtime_settings_cache()
        org_id = uuid4()
        row = AgentRuntimeSettings(
            organization_id=org_id,
            send_deadline_seconds=None,
            failover_enabled=True,
            resume_enabled=True,
            circuit_breaker_failure_threshold=DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
            circuit_breaker_recovery_seconds=DEFAULT_CIRCUIT_BREAKER_RECOVERY_SECONDS,
        )
        session = _session_returning(row)

        resolved = await get_runtime_settings(session, org_id)

        assert resolved.send_deadline_seconds == DEFAULT_SEND_DEADLINE_SECONDS

    asyncio.run(run())


def test_failed_db_call_returns_defaults_without_raising() -> None:
    async def run() -> None:
        invalidate_runtime_settings_cache()
        org_id = uuid4()
        session = MagicMock()
        session.execute = AsyncMock(side_effect=RuntimeError("db down"))

        resolved = await get_runtime_settings(session, org_id)

        assert resolved.send_deadline_seconds == DEFAULT_SEND_DEADLINE_SECONDS

    asyncio.run(run())
