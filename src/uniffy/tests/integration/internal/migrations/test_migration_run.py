"""Exercise fresh installation and schema upgrades against isolated databases."""

import asyncio
from collections.abc import Callable
from uuid import UUID

import asyncpg
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Connection, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from uniffy.core.json_codec import dumps_str, loads
from uniffy.core.models.chat.channel import ChannelType
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.types import generate_id
from uniffy.infrastructure.database.session import (
    ALEMBIC_INI_PATH,
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


async def _query(sql: str) -> list[tuple]:
    conn = await asyncpg.connect(
        get_database_url().replace("postgresql+asyncpg://", "postgresql://", 1)
    )
    try:
        for name in ("json", "jsonb"):
            await conn.set_type_codec(name, schema="pg_catalog", encoder=dumps_str, decoder=loads)
        return [tuple(row) for row in await conn.fetch(sql)]
    finally:
        await conn.close()


async def _execute(sql: str, *args: object) -> None:
    conn = await asyncpg.connect(
        get_database_url().replace("postgresql+asyncpg://", "postgresql://", 1)
    )
    try:
        await conn.execute(sql, *args)
    finally:
        await conn.close()


async def _insert_chat_channel(
    session: AsyncSession,
    *,
    organization_id: UUID,
    owner_id: UUID,
    name: str,
    channel_type: ChannelType,
) -> UUID:
    """Write the channel row an older revision has; the head model carries later columns."""
    channel_id = generate_id()
    await session.execute(
        text(
            "INSERT INTO chat_channels (id, organization_id, owner_id, name, slug, description, "
            "channel_type, is_archived, is_default, is_deleted, icon, is_agent_dm, created_at, "
            "updated_at) VALUES (:id, :org, :owner, :name, :slug, '', CAST(:type AS channeltype), "
            "false, false, false, '', false, now(), now())"
        ),
        {
            "id": channel_id,
            "org": organization_id,
            "owner": owner_id,
            "name": name,
            "slug": name.lower(),
            "type": channel_type.value,
        },
    )
    return channel_id


async def _insert_organization_member(
    session: AsyncSession,
    *,
    organization_id: UUID,
    user_id: UUID,
    role: OrganizationRole = OrganizationRole.MEMBER,
) -> UUID:
    """Write the membership row an older revision has; the head model carries later columns."""
    membership_id = generate_id()
    await session.execute(
        text(
            "INSERT INTO login_organization_members (id, user_id, organization_id, role, "
            "is_active, joined_at, updated_at) VALUES (:id, :user, :org, "
            "CAST(:role AS organizationrole), true, now(), now())"
        ),
        {"id": membership_id, "user": user_id, "org": organization_id, "role": role.value},
    )
    return membership_id


async def _insert_organization(session: AsyncSession, *, name: str, slug: str) -> UUID:
    """Write the organization row an older revision has; the head model carries later columns."""
    organization_id = generate_id()
    await session.execute(
        text(
            "INSERT INTO login_organizations (id, name, slug, created_at) "
            "VALUES (:id, :name, :slug, now())"
        ),
        {"id": organization_id, "name": name, "slug": slug},
    )
    return organization_id


async def _run_alembic(
    config: Config, operation: Callable[[Config, str], None], revision: str
) -> None:
    engine = create_async_engine(
        get_database_url(), connect_args={"server_settings": {"TimeZone": "UTC"}}
    )

    def run(connection: Connection) -> None:
        config.attributes["connection"] = connection
        operation(config, revision)

    try:
        async with engine.connect() as connection:
            await connection.run_sync(run)
    finally:
        await engine.dispose()


async def _migrate_to(revision: str) -> None:
    config = Config(str(ALEMBIC_INI_PATH))
    config.attributes["configure_logger"] = False
    await _run_alembic(config, command.upgrade, revision)


async def _provision(scratch_database: str) -> None:
    """Extensions then migrations, the same order `init_db` uses."""
    engine = create_async_engine(get_database_url())
    try:
        await create_extensions(engine)
    finally:
        await engine.dispose()
    await run_migrations()


async def _provision_to(scratch_database: str, revision: str) -> None:
    engine = create_async_engine(get_database_url())
    try:
        await create_extensions(engine)
    finally:
        await engine.dispose()
    await _migrate_to(revision)


async def test_an_empty_database_migrates_to_head(scratch_database: str) -> None:
    await _provision(scratch_database)

    stamped = await _query("SELECT version_num FROM alembic_version")
    assert [row[0] for row in stamped] == [_head_revision()]


async def test_alembic_cli_migrates_an_empty_database(scratch_database: str) -> None:
    engine = create_async_engine(get_database_url())
    try:
        await create_extensions(engine)
    finally:
        await engine.dispose()
    process = await asyncio.create_subprocess_exec(
        "alembic",
        "-c",
        ALEMBIC_INI_PATH,
        "upgrade",
        "head",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    try:
        output, _ = await asyncio.wait_for(process.communicate(), 60)
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()
    assert process.returncode == 0, output.decode()
    assert await _query("SELECT version_num FROM alembic_version") == [(_head_revision(),)]


async def test_every_declared_table_exists_after_the_upgrade(scratch_database: str) -> None:
    """Catch missing table migrations even when Alembic is at head."""
    await _provision(scratch_database)

    rows = await _query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    )
    built = {row[0] for row in rows}
    declared = _declared_tables()
    assert declared <= built, f"declared by a model, never created: {sorted(declared - built)}"


async def test_running_the_chain_twice_is_a_no_op(scratch_database: str) -> None:
    """Every boot calls `run_migrations`, so a second pass must not fail."""
    await _provision(scratch_database)
    await run_migrations()

    stamped = await _query("SELECT version_num FROM alembic_version")
    assert [row[0] for row in stamped] == [_head_revision()]


async def test_audit_resource_type_migration_normalizes_append_only_rows(
    scratch_database: str,
) -> None:
    await _provision_to(scratch_database, "083")
    await _execute(
        "INSERT INTO audit_events (id, action, resource_type) "
        "VALUES (gen_random_uuid(), 'migration.probe', 'organization')"
    )

    await _migrate_to("084")

    assert (
        await _query("SELECT resource_type FROM audit_events WHERE action = 'migration.probe'")
    ) == [("ORGANIZATION",)]

    config = Config(str(ALEMBIC_INI_PATH))
    config.attributes["configure_logger"] = False
    await _run_alembic(config, command.downgrade, "083")
    assert (
        await _query("SELECT resource_type FROM audit_events WHERE action = 'migration.probe'")
    ) == [("organization",)]


async def test_playback_backfill_and_reversible_schema(scratch_database: str) -> None:
    await _provision_to(scratch_database, "102")
    await _execute(
        "INSERT INTO login_organizations (name, slug, created_at) VALUES ('media', 'media', now())"
    )
    await _execute(
        "INSERT INTO login_users (email, username, cache_key_seed, created_at) VALUES ('media@test.local', 'media', decode(repeat('00', 32), 'hex'), now())"
    )
    await _execute("""
        INSERT INTO files_files (organization_id, owner_id, filename, original_filename,
            mime_type, size_bytes, storage_key, storage_bucket, created_at, transcode_status)
        SELECT o.id, u.id, v.name, v.name, v.mime, 1, v.name, 'test', now(),
            v.status::transcodestatus
        FROM login_organizations o CROSS JOIN login_users u CROSS JOIN
            (VALUES ('video', 'video/quicktime', 'NOT_NEEDED'),
                    ('recording', 'video/webm', 'PENDING'),
                    ('document', 'application/pdf', 'NOT_NEEDED')) AS v(name, mime, status)
    """)
    await _migrate_to("103")
    assert (
        await _query(
            "SELECT storage_key, playback_status::text, playback_attempts FROM files_files ORDER BY storage_key"
        )
    ) == [("document", "NOT_NEEDED", 0), ("recording", "NOT_NEEDED", 0), ("video", "PENDING", 0)]
    config = Config(str(ALEMBIC_INI_PATH))
    config.attributes["configure_logger"] = False
    await _run_alembic(config, command.downgrade, "102")
    assert (await _query("SELECT count(*) FROM files_files")) == [(3,)]
    assert (await _query("SELECT to_regclass('files_renditions')")) == [(None,)]
    await _migrate_to("103")
    assert (
        await _query("SELECT playback_status::text FROM files_files WHERE storage_key = 'video'")
    ) == [("PENDING",)]


async def test_attachment_backfill_preserves_source_policy_and_explicit_grants(
    scratch_database: str,
) -> None:
    await _provision_to(scratch_database, "103")
    await _execute(
        "INSERT INTO login_organizations (name, slug, created_at) VALUES ('attachments', 'attachments', now())"
    )
    await _execute(
        "INSERT INTO login_users (email, username, cache_key_seed, created_at) VALUES ('attachments@test.local', 'attachments', decode(repeat('00', 32), 'hex'), now())"
    )
    await _execute("""
        INSERT INTO files_files (organization_id, owner_id, filename, original_filename,
            mime_type, size_bytes, storage_key, storage_bucket, created_at, access_mode, baseline_role)
        SELECT o.id, u.id, v.name, v.name, 'video/mp4', 1, v.name, 'test', now(),
            v.mode::accessmode, 'VIEWER'::contentrole
        FROM login_organizations o CROSS JOIN login_users u CROSS JOIN
            (VALUES ('source', 'OPEN_TO_ORG'), ('copy', 'OPEN_TO_ORG'), ('inherited', NULL)) AS v(name, mode)
    """)
    await _execute("""
        INSERT INTO attachments_attachments (id, organization_id, file_id, source_file_id,
            content_type, content_id, attached_by_user_id, attached_at)
        SELECT gen_random_uuid(), f.organization_id, f.id, s.id, 'NOTE', gen_random_uuid(), f.owner_id, now()
        FROM files_files f CROSS JOIN files_files s
        WHERE f.storage_key IN ('copy', 'inherited') AND s.storage_key = 'source'
    """)
    await _execute("""
        INSERT INTO permissions_content_members (id, organization_id, content_type, content_id,
            subject_type, subject_id, role, added_by_user_id, added_at)
        SELECT gen_random_uuid(), organization_id, 'FILE', id, 'USER', owner_id, 'VIEWER', owner_id, now()
        FROM files_files WHERE storage_key = 'copy'
    """)
    await _migrate_to("104")
    expected = [
        ("copy", "OWNER_ONLY", None),
        ("inherited", "OWNER_ONLY", None),
        ("source", "OPEN_TO_ORG", "VIEWER"),
    ]
    assert (
        await _query(
            "SELECT storage_key, access_mode::text, baseline_role::text FROM files_files ORDER BY storage_key"
        )
    ) == expected
    assert (await _query("SELECT role::text FROM permissions_content_members")) == [("VIEWER",)]
    config = Config(str(ALEMBIC_INI_PATH))
    config.attributes["configure_logger"] = False
    await _run_alembic(config, command.downgrade, "103")
    assert (
        await _query(
            "SELECT storage_key, access_mode::text, baseline_role::text FROM files_files ORDER BY storage_key"
        )
    ) == expected
