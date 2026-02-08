"""Add attachments system.

This migration:
1. Adds is_system column to files_folders table for protected folders
2. Creates attachments_attachments table for linking files to content

Revision ID: 011
Revises: 010
Create Date: 2026-02-05

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "011"
down_revision: str | None = "010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add attachments system tables and columns."""
    # Add is_system column to files_folders
    op.add_column(
        "files_folders",
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default="false"),
    )

    # Create attachments table
    op.create_table(
        "attachments_attachments",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("file_id", sa.Uuid(), nullable=False),
        sa.Column(
            "content_type",
            postgresql.ENUM(
                "NOTE",
                "FILE",
                "CALENDAR_EVENT",
                "CHAT_MESSAGE",
                "USER",
                name="contenttype",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("content_id", sa.Uuid(), nullable=False),
        sa.Column("attached_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("attached_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["file_id"], ["files_files.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["attached_by_user_id"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("file_id", name="uq_attachments_file_id"),
    )
    op.create_index(
        "ix_attachments_attachments_organization_id",
        "attachments_attachments",
        ["organization_id"],
    )
    op.create_index(
        "ix_attachments_attachments_file_id",
        "attachments_attachments",
        ["file_id"],
    )
    op.create_index(
        "ix_attachments_attachments_content_type",
        "attachments_attachments",
        ["content_type"],
    )
    op.create_index(
        "ix_attachments_attachments_content_id",
        "attachments_attachments",
        ["content_id"],
    )
    op.create_index(
        "ix_attachments_attachments_attached_by_user_id",
        "attachments_attachments",
        ["attached_by_user_id"],
    )
    op.create_index(
        "ix_attachments_content",
        "attachments_attachments",
        ["content_type", "content_id"],
    )


def downgrade() -> None:
    """Remove attachments system tables and columns."""
    op.drop_index("ix_attachments_content", table_name="attachments_attachments")
    op.drop_index(
        "ix_attachments_attachments_attached_by_user_id",
        table_name="attachments_attachments",
    )
    op.drop_index(
        "ix_attachments_attachments_content_id",
        table_name="attachments_attachments",
    )
    op.drop_index(
        "ix_attachments_attachments_content_type",
        table_name="attachments_attachments",
    )
    op.drop_index(
        "ix_attachments_attachments_file_id",
        table_name="attachments_attachments",
    )
    op.drop_index(
        "ix_attachments_attachments_organization_id",
        table_name="attachments_attachments",
    )
    op.drop_table("attachments_attachments")

    op.drop_column("files_folders", "is_system")
