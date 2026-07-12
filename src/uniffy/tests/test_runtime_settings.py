"""Tests for the per-org agent runtime settings loader and cache."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from uniffy.domains.agents.runtime.settings import (
    DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
    DEFAULT_CIRCUIT_BREAKER_RECOVERY_SECONDS,
    DEFAULT_DISPLAY_CURRENCY,
    DEFAULT_SEND_DEADLINE_SECONDS,
    get_runtime_settings,
    invalidate_runtime_settings_cache,
)


def _session_returning(blob: dict | None) -> MagicMock:
    """Fake AsyncSession whose execute() yields one org_settings 'runtime' row."""
    rows = [SimpleNamespace(key="runtime", value=blob)] if blob is not None else []
    scalars = MagicMock()
    scalars.all = MagicMock(return_value=rows)
    result = MagicMock()
    result.scalars = MagicMock(return_value=scalars)

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
        assert resolved.display_currency == DEFAULT_DISPLAY_CURRENCY

    asyncio.run(run())


def test_blob_overrides_defaults_only_for_set_keys() -> None:
    async def run() -> None:
        invalidate_runtime_settings_cache()
        org_id = uuid4()
        session = _session_returning(
            {
                "send_deadline_seconds": 15,
                "failover_enabled": False,
                "resume_enabled": False,
                "circuit_breaker_failure_threshold": 2,
                "circuit_breaker_recovery_seconds": 5,
                "display_currency": "EUR",
            }
        )

        resolved = await get_runtime_settings(session, org_id)

        assert resolved.send_deadline_seconds == 15
        assert resolved.failover_enabled is False
        assert resolved.resume_enabled is False
        assert resolved.circuit_breaker_failure_threshold == 2
        assert resolved.circuit_breaker_recovery_seconds == 5
        assert resolved.display_currency == "EUR"

    asyncio.run(run())


def test_null_deadline_falls_back_to_module_default() -> None:
    async def run() -> None:
        invalidate_runtime_settings_cache()
        org_id = uuid4()
        session = _session_returning({"send_deadline_seconds": None})

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
