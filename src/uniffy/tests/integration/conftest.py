"""Shared setup for every integration suite.

Two jobs: load the repo-root .env, and make the rest of the tier depend on
the migration suite.

Every other suite here assumes a schema. If the migrations are broken, they
all fail for the same reason and the real one is buried, so the migration
suite runs first and a failure there skips the remainder with a pointed
reason instead. Suite-specific fixtures, including each suite's skip when its
service is absent, live in the suite's own ``conftest.py``.
"""

import pytest

from uniffy.tests.env_file import load_repo_env

load_repo_env()

MIGRATIONS_SUITE = "integration/internal/migrations/"

_migration_failure: str | None = None


def _is_migration_test(nodeid: str) -> bool:
    return MIGRATIONS_SUITE in nodeid.replace("\\", "/")


def pytest_collection_modifyitems(config, items) -> None:
    """Run the migration suite before anything that needs the schema it builds."""
    items.sort(key=lambda item: 0 if _is_migration_test(item.nodeid) else 1)


@pytest.hookimpl(wrapper=True, tryfirst=True)
def pytest_runtest_makereport(item, call):
    report = yield
    global _migration_failure
    if report.failed and _migration_failure is None and _is_migration_test(item.nodeid):
        _migration_failure = item.nodeid
    return report


def pytest_runtest_setup(item) -> None:
    if _migration_failure is None or _is_migration_test(item.nodeid):
        return
    pytest.skip(f"schema unverified: {_migration_failure} failed")
