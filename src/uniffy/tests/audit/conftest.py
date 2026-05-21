"""Shared fixtures for the audit test suite.

Domain-level emission tests assert on the audit-row payload without
caring about the per-write ``OrganizationMember`` role snapshot. The
stub fixture below short-circuits that lookup for every test in this
directory **except** ``test_writer.py``, where the snapshot behaviour
is under test directly.
"""

from pathlib import Path
from unittest.mock import AsyncMock

import pytest

_WRITER_TEST = Path(__file__).parent / "test_writer.py"


@pytest.fixture(autouse=True)
def _stub_snapshot_actor_role(request, monkeypatch):
    if Path(request.node.fspath) == _WRITER_TEST:
        yield
        return
    monkeypatch.setattr(
        "uniffy.core.audit.writer._snapshot_actor_role",
        AsyncMock(return_value=None),
    )
    yield
