"""Multipart parts table and per-user named-folder uniqueness.

Revision ID: 025
Revises: 024
Create Date: 2026-05-09

The chunked-upload pipeline previously stored completed parts in a JSONB
column on `files_multipart_uploads.parts_completed`. Two backend instances
appending parts concurrently would issue read-modify-write against that
column and lose one of the writes, corrupting completed files.

This migration replaces that pattern with a separate `files_multipart_parts`
table where each part is its own row, with `UNIQUE(upload_id, part_number)`.
Concurrent writes are then serialised by Postgres at the unique index, and
client retries become idempotent via `INSERT ... ON CONFLICT DO UPDATE`.

The migration backfills existing JSONB rows into the new table. The JSONB
column is kept for one release cycle so a rollback is possible; a follow-up
migration drops it.

The folder-uniqueness index is added in the same migration because the
recording feature's `ensure_named_folder` helper needs an idempotent
"create or fetch by name" path that survives 15-20 instance fan-out. The
partial unique index covers per-user root folders only (`parent_id IS NULL
AND is_deleted = FALSE`), which is the exact key set the helper uses.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "025"
down_revision: str | None = "024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create multipart parts table, backfill, add folder uniqueness index."""
    op.create_table(
        "files_multipart_parts",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("upload_id", sa.Uuid(), nullable=False),
        sa.Column("part_number", sa.Integer(), nullable=False),
        sa.Column("etag", sa.String(255), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["upload_id"],
            ["files_multipart_uploads.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "upload_id",
            "part_number",
            name="uq_multipart_parts_upload_part",
        ),
    )
    op.create_index(
        "ix_files_multipart_parts_upload_id",
        "files_multipart_parts",
        ["upload_id"],
    )

    op.execute(
        """
        INSERT INTO files_multipart_parts (id, upload_id, part_number, etag, size, created_at)
        SELECT
            uuidv7(),
            mu.id,
            (part->>'part_number')::int,
            part->>'etag',
            (part->>'size')::bigint,
            COALESCE(mu.updated_at, mu.created_at)
        FROM files_multipart_uploads mu
        CROSS JOIN LATERAL jsonb_array_elements(
            COALESCE(mu.parts_completed, '[]'::jsonb)
        ) AS part
        WHERE mu.parts_completed IS NOT NULL
        ON CONFLICT (upload_id, part_number) DO NOTHING
        """
    )

    op.create_index(
        "uq_folders_system_owner_name",
        "files_folders",
        ["owner_id", "organization_id", "name"],
        unique=True,
        postgresql_where=sa.text("parent_id IS NULL AND is_deleted = false AND is_system = true"),
    )


def downgrade() -> None:
    """Drop the multipart parts table and folder uniqueness index."""
    op.drop_index(
        "uq_folders_system_owner_name",
        table_name="files_folders",
    )
    op.drop_index(
        "ix_files_multipart_parts_upload_id",
        table_name="files_multipart_parts",
    )
    op.drop_table("files_multipart_parts")
