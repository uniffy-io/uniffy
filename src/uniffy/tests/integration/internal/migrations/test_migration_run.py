"""The migration chain applied to an empty database.

This is the check a release depends on: a fresh deployment runs every
migration in order, and it either works or the deploy is broken. The dev
database cannot answer that question because it is already at head, so each
test here gets its own empty database.

The order mirrors `init_db`: extensions first, then migrations. A migration
that reaches for `gen_random_uuid()` or a trigram index has to find the
extension already there.
"""

import psycopg2
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy.ext.asyncio import create_async_engine

from uniffy.infrastructure.database.session import (
    ALEMBIC_INI_PATH,
    _build_sync_db_url,
    create_extensions,
    get_database_url,
    run_migrations,
)


def _declared_tables() -> set[str]:
    """Every table the models declare, which the migrations are supposed to build."""
    import uniffy.core.models  # noqa: F401  (import populates the metadata)
    from uniffy.infrastructure.database.base import SQLModel

    return set(SQLModel.metadata.tables)


def _head_revision() -> str:
    config = Config(str(ALEMBIC_INI_PATH))
    config.attributes["configure_logger"] = False
    return ScriptDirectory.from_config(config).get_current_head()


def _query(sql: str):
    conn = psycopg2.connect(_build_sync_db_url())
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
            return cur.fetchall()
    finally:
        conn.close()


def _execute(sql: str) -> None:
    conn = psycopg2.connect(_build_sync_db_url())
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
    finally:
        conn.close()


def _migrate_to(revision: str) -> None:
    config = Config(str(ALEMBIC_INI_PATH))
    config.attributes["configure_logger"] = False
    command.upgrade(config, revision)


async def _provision(scratch_database: str) -> None:
    """Extensions then migrations, the same order `init_db` uses."""
    engine = create_async_engine(get_database_url())
    try:
        await create_extensions(engine)
    finally:
        await engine.dispose()
    run_migrations()


async def _provision_to(scratch_database: str, revision: str) -> None:
    engine = create_async_engine(get_database_url())
    try:
        await create_extensions(engine)
    finally:
        await engine.dispose()
    _migrate_to(revision)


async def test_an_empty_database_migrates_to_head(scratch_database: str) -> None:
    await _provision(scratch_database)

    stamped = _query("SELECT version_num FROM alembic_version")
    assert [row[0] for row in stamped] == [_head_revision()]


async def test_every_declared_table_exists_after_the_upgrade(scratch_database: str) -> None:
    """A head stamp with nothing under it would still pass the check above.

    Comparing against the model metadata also catches the other drift: a model
    added without the migration that creates its table.
    """
    await _provision(scratch_database)

    rows = _query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
    built = {row[0] for row in rows}
    declared = _declared_tables()
    assert declared <= built, f"declared by a model, never created: {sorted(declared - built)}"


async def test_running_the_chain_twice_is_a_no_op(scratch_database: str) -> None:
    """Every boot calls `run_migrations`, so a second pass must not fail."""
    await _provision(scratch_database)
    run_migrations()

    stamped = _query("SELECT version_num FROM alembic_version")
    assert [row[0] for row in stamped] == [_head_revision()]


async def test_audit_resource_type_migration_normalizes_append_only_rows(
    scratch_database: str,
) -> None:
    await _provision_to(scratch_database, "083")
    _execute(
        "INSERT INTO audit_events (id, action, resource_type) "
        "VALUES (gen_random_uuid(), 'migration.probe', 'organization')"
    )

    _migrate_to("084")

    assert _query("SELECT resource_type FROM audit_events WHERE action = 'migration.probe'") == [
        ("ORGANIZATION",)
    ]

    config = Config(str(ALEMBIC_INI_PATH))
    config.attributes["configure_logger"] = False
    command.downgrade(config, "083")
    assert _query("SELECT resource_type FROM audit_events WHERE action = 'migration.probe'") == [
        ("organization",)
    ]


async def test_playback_backfill_and_reversible_schema(scratch_database: str) -> None:
    await _provision_to(scratch_database, "102")
    _execute(
        "INSERT INTO login_organizations (name, slug, created_at) VALUES ('media', 'media', now())"
    )
    _execute(
        "INSERT INTO login_users (email, username, cache_key_seed, created_at) VALUES ('media@test.local', 'media', decode(repeat('00', 32), 'hex'), now())"
    )
    _execute("""
        INSERT INTO files_files (organization_id, owner_id, filename, original_filename,
            mime_type, size_bytes, storage_key, storage_bucket, created_at, transcode_status)
        SELECT o.id, u.id, v.name, v.name, v.mime, 1, v.name, 'test', now(),
            v.status::transcodestatus
        FROM login_organizations o CROSS JOIN login_users u CROSS JOIN
            (VALUES ('video', 'video/quicktime', 'NOT_NEEDED'),
                    ('recording', 'video/webm', 'PENDING'),
                    ('document', 'application/pdf', 'NOT_NEEDED')) AS v(name, mime, status)
    """)
    _migrate_to("103")
    assert _query(
        "SELECT storage_key, playback_status::text, playback_attempts FROM files_files ORDER BY storage_key"
    ) == [("document", "NOT_NEEDED", 0), ("recording", "NOT_NEEDED", 0), ("video", "PENDING", 0)]
    config = Config(str(ALEMBIC_INI_PATH))
    config.attributes["configure_logger"] = False
    command.downgrade(config, "102")
    assert _query("SELECT count(*) FROM files_files") == [(3,)]
    assert _query("SELECT to_regclass('files_renditions')") == [(None,)]
    _migrate_to("103")
    assert _query("SELECT playback_status::text FROM files_files WHERE storage_key = 'video'") == [
        ("PENDING",)
    ]


async def test_attachment_backfill_preserves_source_policy_and_explicit_grants(
    scratch_database: str,
) -> None:
    await _provision_to(scratch_database, "103")
    _execute(
        "INSERT INTO login_organizations (name, slug, created_at) VALUES ('attachments', 'attachments', now())"
    )
    _execute(
        "INSERT INTO login_users (email, username, cache_key_seed, created_at) VALUES ('attachments@test.local', 'attachments', decode(repeat('00', 32), 'hex'), now())"
    )
    _execute("""
        INSERT INTO files_files (organization_id, owner_id, filename, original_filename,
            mime_type, size_bytes, storage_key, storage_bucket, created_at, access_mode, baseline_role)
        SELECT o.id, u.id, v.name, v.name, 'video/mp4', 1, v.name, 'test', now(),
            v.mode::accessmode, 'VIEWER'::contentrole
        FROM login_organizations o CROSS JOIN login_users u CROSS JOIN
            (VALUES ('source', 'OPEN_TO_ORG'), ('copy', 'OPEN_TO_ORG'), ('inherited', NULL)) AS v(name, mode)
    """)
    _execute("""
        INSERT INTO attachments_attachments (id, organization_id, file_id, source_file_id,
            content_type, content_id, attached_by_user_id, attached_at)
        SELECT gen_random_uuid(), f.organization_id, f.id, s.id, 'NOTE', gen_random_uuid(), f.owner_id, now()
        FROM files_files f CROSS JOIN files_files s
        WHERE f.storage_key IN ('copy', 'inherited') AND s.storage_key = 'source'
    """)
    _execute("""
        INSERT INTO permissions_content_members (id, organization_id, content_type, content_id,
            subject_type, subject_id, role, added_by_user_id, added_at)
        SELECT gen_random_uuid(), organization_id, 'FILE', id, 'USER', owner_id, 'VIEWER', owner_id, now()
        FROM files_files WHERE storage_key = 'copy'
    """)
    _migrate_to("104")
    expected = [
        ("copy", "OWNER_ONLY", None),
        ("inherited", "OWNER_ONLY", None),
        ("source", "OPEN_TO_ORG", "VIEWER"),
    ]
    assert (
        _query(
            "SELECT storage_key, access_mode::text, baseline_role::text FROM files_files ORDER BY storage_key"
        )
        == expected
    )
    assert _query("SELECT role::text FROM permissions_content_members") == [("VIEWER",)]
    config = Config(str(ALEMBIC_INI_PATH))
    config.attributes["configure_logger"] = False
    command.downgrade(config, "103")
    assert (
        _query(
            "SELECT storage_key, access_mode::text, baseline_role::text FROM files_files ORDER BY storage_key"
        )
        == expected
    )
