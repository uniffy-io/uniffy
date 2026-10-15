"""Realtime snapshots gain checkpoint metadata without touching the CRDT bytes they hold."""

from alembic import command
from alembic.config import Config

from uniffy.core.types import generate_id
from uniffy.infrastructure.database.session import ALEMBIC_INI_PATH
from uniffy.tests.integration.internal.migrations.test_migration_run import (
    _execute,
    _migrate_to,
    _provision_to,
    _query,
)

_STATE_VECTOR = bytes.fromhex("01a7c3f20b00")
_UPDATES = bytes.fromhex("0001ff00fe80c0de7f")
_CHECKPOINT_COLUMNS = {"buffer_epoch", "valkey_run_id", "checkpoint_seq"}


def _downgrade_to(revision: str) -> None:
    config = Config(str(ALEMBIC_INI_PATH))
    config.attributes["configure_logger"] = False
    command.downgrade(config, revision)


def _seed_snapshots() -> None:
    _execute(
        "INSERT INTO realtime_yjs_snapshots (content_type, content_id, organization_id, "
        "generation, revision, rendered_revision, effects_pending, actor_id, seed_owner, "
        "seed_expires_at, state_vector, updates, created_at, updated_at) VALUES "
        f"('NOTE', '{generate_id()}', '{generate_id()}', 'gen-live', 42, 41, true, "
        f"'{generate_id()}', 'replica-a', now() + interval '5 minutes', "
        f"decode('{_STATE_VECTOR.hex()}', 'hex'), decode('{_UPDATES.hex()}', 'hex'), "
        "now() - interval '1 day', now()), "
        f"('TASK', '{generate_id()}', NULL, NULL, 0, 0, false, NULL, NULL, NULL, "
        "decode('00', 'hex'), decode('0000', 'hex'), now(), now())"
    )


def _snapshots() -> list[tuple]:
    rows = _query(
        "SELECT content_type::text, content_id::text, organization_id::text, generation, "
        "revision, rendered_revision, effects_pending, actor_id::text, seed_owner, "
        "seed_expires_at, state_vector, updates, created_at, updated_at "
        "FROM realtime_yjs_snapshots ORDER BY content_type"
    )
    return [(*row[:10], bytes(row[10]), bytes(row[11]), *row[12:]) for row in rows]


def _checkpoint_metadata() -> list[tuple]:
    return _query(
        "SELECT buffer_epoch, valkey_run_id, checkpoint_seq "
        "FROM realtime_yjs_snapshots ORDER BY content_type"
    )


def _snapshot_columns() -> set[str]:
    return {
        row[0]
        for row in _query(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'realtime_yjs_snapshots'"
        )
    }


async def test_upgrade_keeps_snapshots_and_starts_them_at_a_neutral_checkpoint(
    scratch_database: str,
) -> None:
    await _provision_to(scratch_database, "110")
    _seed_snapshots()
    before = _snapshots()
    assert before[0][3:6] == ("gen-live", 42, 41)
    assert before[0][10:12] == (_STATE_VECTOR, _UPDATES)

    _migrate_to("111")

    assert _snapshots() == before
    assert _checkpoint_metadata() == [(None, None, 0), (None, None, 0)]


async def test_downgrade_drops_checkpoint_metadata_and_keeps_snapshots(
    scratch_database: str,
) -> None:
    await _provision_to(scratch_database, "110")
    _seed_snapshots()
    before = _snapshots()
    _migrate_to("111")
    _execute(
        "UPDATE realtime_yjs_snapshots SET buffer_epoch = 'epoch-1', "
        "valkey_run_id = 'run-1', checkpoint_seq = 9000000000"
    )
    assert _checkpoint_metadata() == [("epoch-1", "run-1", 9_000_000_000)] * 2

    _downgrade_to("110")

    assert not _CHECKPOINT_COLUMNS & _snapshot_columns()
    assert _snapshots() == before

    _migrate_to("111")

    assert _snapshots() == before
    assert _checkpoint_metadata() == [(None, None, 0), (None, None, 0)]


async def test_empty_database_upgrades_with_checkpoint_metadata(scratch_database: str) -> None:
    await _provision_to(scratch_database, "111")

    assert _query("SELECT version_num FROM alembic_version") == [("111",)]
    assert _CHECKPOINT_COLUMNS <= _snapshot_columns()
    _seed_snapshots()
    assert _checkpoint_metadata() == [(None, None, 0), (None, None, 0)]
