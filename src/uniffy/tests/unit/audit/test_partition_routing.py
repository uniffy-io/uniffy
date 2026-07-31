"""Migration shape: monthly RANGE partitions + four indexes.

The actual partition-routing behaviour is a PostgreSQL property and
covered by integration tests once the suite has a live DB fixture.
This unit-level check guards the migration's DDL shape: it must
declare ``PARTITION BY RANGE (created_at)`` on the parent, pre-create
four monthly partitions covering ``[prev_month, current_month + 2)``,
and emit the four named indexes (``ix_audit_org_created``,
``ix_audit_actor_created``, ``ix_audit_resource_created``,
``ix_audit_org_action_created``).
"""

import importlib.util
from pathlib import Path

MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "db"
    / "migrations"
    / "versions"
    / "039_audit_events.py"
)


def _source() -> str:
    return MIGRATION_PATH.read_text()


def _load_module():
    spec = importlib.util.spec_from_file_location(
        "audit_events_migration", MIGRATION_PATH
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_audit_events_table_is_range_partitioned_on_created_at() -> None:
    src = _source()
    assert "PARTITION BY RANGE (created_at)" in src


def test_migration_creates_four_initial_partitions() -> None:
    module = _load_module()
    bounds = module._initial_partition_bounds()
    assert len(bounds) == 4
    for starts, ends in bounds:
        assert starts.day == 1
        assert ends.day == 1
        assert ends > starts


def test_migration_creates_the_four_required_indexes() -> None:
    src = _source()
    for index_name in (
        "ix_audit_org_created",
        "ix_audit_actor_created",
        "ix_audit_resource_created",
        "ix_audit_org_action_created",
    ):
        assert index_name in src


def test_migration_drops_legacy_tables() -> None:
    src = _source()
    assert "DROP TABLE IF EXISTS permissions_content_member_events" in src
    assert "DROP TABLE IF EXISTS agents_audit_logs" in src
