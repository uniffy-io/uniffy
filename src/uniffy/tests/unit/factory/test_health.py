"""The health endpoint reports whether realtime edits can be buffered, without failing on it."""

import asyncio
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from uniffy.core.realtime.preflight import run_preflight
from uniffy.core.search.engine import SearchEngine
from uniffy.core.storage import ObjectStorage
from uniffy.factory import create_app


class EvictingValkey:
    config = {"maxmemory-policy": "allkeys-lru", "maxmemory": "0"}

    async def info(self, section: str) -> dict[str, object]:
        if section == "server":
            return {"run_id": "f" * 40, "valkey_version": "9.1.2"}
        return {"aof_enabled": 1}

    async def config_get(self, pattern: str) -> dict[str, str]:
        return {pattern: self.config[pattern]} if pattern in self.config else {}


def test_health_reports_a_disabled_realtime_buffer_and_stays_up(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CORS_ORIGINS", "http://testserver")
    app = create_app(
        storage=MagicMock(spec=ObjectStorage),
        search_engine=MagicMock(spec=SearchEngine),
    )
    asyncio.run(run_preflight(EvictingValkey()))

    response = TestClient(app).get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "uniffy", "realtime_buffer": "disabled"}
