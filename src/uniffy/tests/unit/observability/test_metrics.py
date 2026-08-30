import subprocess
import sys
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from uniffy.core.search.engine import SearchEngine
from uniffy.core.storage import ObjectStorage
from uniffy.factory import create_app
from uniffy.infrastructure.observability.prometheus import get_metrics


def test_bootstrap_module_does_not_import_prometheus() -> None:
    subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys; import uniffy.infrastructure.observability.bootstrap; "
            "assert 'prometheus_client' not in sys.modules",
        ],
        check=True,
    )


def test_renderer_runs_lazy_collectors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PROMETHEUS_MULTIPROC_DIR", raising=False)
    collected: list[bool] = []

    payload = get_metrics((lambda: collected.append(True),))

    assert collected == [True]
    assert b"# HELP" in payload


def test_metrics_endpoint_renders_prometheus(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", "http://testserver")
    monkeypatch.delenv("PROMETHEUS_MULTIPROC_DIR", raising=False)
    app = create_app(
        storage=MagicMock(spec=ObjectStorage),
        search_engine=MagicMock(spec=SearchEngine),
    )

    response = TestClient(app).get("/metrics")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    assert "# HELP" in response.text
