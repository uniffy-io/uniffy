"""Add per-org Attachments system folder + ``is_org_attachments`` flag.

Revision ID: 031
Revises: 030
Create Date: 2026-05-18

Adds a single ``Attachments`` folder per organization for files
attached to content whose effective access mode is ``OPEN_TO_ORG``.
The org folder carries an explicit ``OPEN_TO_ORG`` / ``EDITOR`` policy
so its semantics never drift with the org's Files defaults. Backfill
re-routes existing attachments to the new folder when their parent
content resolves to ``OPEN_TO_ORG``.
"""

from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision: str = "031"
down_revision: str | None = "030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "files_folders",
        sa.Column(
            "is_org_attachments",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.create_index(
        "ix_files_folders_org_attachments",
        "files_folders",
        ["organization_id", "is_org_attachments"],
        unique=False,
    )

    bind = op.get_bind()
    orgs = bind.execute(sa.text("SELECT id FROM login_organizations")).fetchall()
    now = datetime.now(UTC)
    folder_id_by_org: dict[str, str] = {}
    for row in orgs:
        org_id = str(row[0])
        owner_row = bind.execute(
            sa.text(
                """
                SELECT user_id FROM login_organization_members
                WHERE organization_id = :org_id
                  AND is_active = true
                ORDER BY CASE role
                    WHEN 'OWNER' THEN 0
                    WHEN 'ADMIN' THEN 1
                    ELSE 2 END,
                  joined_at
                LIMIT 1
                """
            ),
            {"org_id": org_id},
        ).first()
        if owner_row is None:
            continue
        owner_id = str(owner_row[0])
        folder_id = str(uuid4())
        folder_id_by_org[org_id] = folder_id
        bind.execute(
            sa.text(
                """
                INSERT INTO files_folders (
                    id, organization_id, owner_id, access_mode, baseline_role,
                    name, parent_id, is_system, is_org_attachments,
                    is_deleted, created_at, updated_at
                )
                VALUES (
                    :id, :organization_id, :owner_id, 'OPEN_TO_ORG', 'EDITOR',
                    'Organization Attachments', NULL, true, true,
                    false, :now, :now
                )
                """
            ),
            {
                "id": folder_id,
                "organization_id": org_id,
                "owner_id": owner_id,
                "now": now,
            },
        )

    # Re-route attachments whose parent content resolves to OPEN_TO_ORG
    # (explicit access_mode = 'OPEN_TO_ORG', or NULL with an org default
    # of OPEN_TO_ORG for the content type).
    rows = bind.execute(
        sa.text(
            """
            SELECT a.id, a.file_id, a.content_type, a.content_id, a.organization_id
            FROM attachments_attachments a
            """
        )
    ).fetchall()

    for att in rows:
        att_id = att[0]  # noqa: F841 - reserved for future audit hook
        file_id = att[1]
        content_type = att[2]
        content_id = att[3]
        organization_id = str(att[4])

        eff_mode = _resolve_effective_mode(bind, content_type, content_id, organization_id)
        if eff_mode != "OPEN_TO_ORG":
            continue

        org_folder_id = folder_id_by_org.get(organization_id)
        if not org_folder_id:
            continue

        bind.execute(
            sa.text(
                """
                UPDATE files_files
                SET folder_id = :folder_id,
                    access_mode = 'OPEN_TO_ORG',
                    baseline_role = 'EDITOR'
                WHERE id = :file_id
                """
            ),
            {"folder_id": org_folder_id, "file_id": file_id},
        )


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM files_folders WHERE is_org_attachments = true"))
    op.drop_index("ix_files_folders_org_attachments", table_name="files_folders")
    op.drop_column("files_folders", "is_org_attachments")


def _resolve_effective_mode(
    bind, content_type: str, content_id, organization_id: str
) -> str:
    """Materialise the effective access mode for one row in raw SQL."""
    table_for_type = {
        "NOTE": ("notes_notes", "id"),
        "FILE": ("files_files", "id"),
        "FOLDER": ("files_folders", "id"),
        "CALENDAR_EVENT": ("calendar_events", "id"),
        "PROJECT": ("projects_projects", "id"),
        "AGENT": ("agents_agents", "id"),
        "PROMPT": ("agents_prompts", "id"),
        "PROVIDER_KEY": ("agents_provider_keys", "id"),
        "AGENT_CRON_TASK": ("agents_cron_tasks", "id"),
    }
    entry = table_for_type.get(content_type)
    if not entry:
        return "OWNER_ONLY"

    table, id_col = entry
    row = bind.execute(
        sa.text(
            f"SELECT access_mode FROM {table} WHERE {id_col} = :cid AND organization_id = :org"
        ),
        {"cid": content_id, "org": organization_id},
    ).first()
    if row is None:
        return "OWNER_ONLY"
    if row[0] is not None:
        return row[0]

    default = bind.execute(
        sa.text(
            """
            SELECT default_access_mode
            FROM permissions_org_defaults
            WHERE organization_id = :org AND content_type = :ct
            """
        ),
        {"org": organization_id, "ct": content_type},
    ).first()
    if default is None or default[0] is None:
        return "OWNER_ONLY"
    return default[0]
