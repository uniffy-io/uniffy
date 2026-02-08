"""Create content permission tables.

Revision ID: 003
Revises: 002
Create Date: 2026-01-20

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "003"
down_revision: str | None = "002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create permission tables for content access control."""
    # Content Permissions (fine-grained access control)
    op.create_table(
        "permissions_content_permissions",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column(
            "content_type",
            postgresql.ENUM(
                "note",
                "file",
                "calendar_event",
                "book",
                "password",
                "workflow",
                "chat_message",
                "space",
                name="contenttype",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("content_id", sa.Uuid(), nullable=False),
        sa.Column(
            "subject_type",
            postgresql.ENUM("user", "group", "organization", name="subjecttype", create_type=False),
            nullable=False,
        ),
        sa.Column("subject_id", sa.Uuid(), nullable=False),
        sa.Column(
            "permission_level",
            postgresql.ENUM(
                "view", "edit", "admin", "owner", name="permissionlevel", create_type=False
            ),
            nullable=False,
        ),
        sa.Column("can_view", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("can_edit", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("can_delete", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("can_share", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("can_move", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("granted_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["granted_by_user_id"], ["login_users.id"]),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_permissions_content_permissions_organization_id",
        "permissions_content_permissions",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        "ix_permissions_content_permissions_content_type",
        "permissions_content_permissions",
        ["content_type"],
        unique=False,
    )
    op.create_index(
        "ix_permissions_content_permissions_content_id",
        "permissions_content_permissions",
        ["content_id"],
        unique=False,
    )
    op.create_index(
        "ix_permissions_content_permissions_subject_type",
        "permissions_content_permissions",
        ["subject_type"],
        unique=False,
    )
    op.create_index(
        "ix_permissions_content_permissions_subject_id",
        "permissions_content_permissions",
        ["subject_id"],
        unique=False,
    )

    # Content Group Links (associate content with groups for GROUP visibility)
    op.create_table(
        "permissions_content_group_links",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column(
            "content_type",
            postgresql.ENUM(
                "note",
                "file",
                "calendar_event",
                "book",
                "password",
                "workflow",
                "chat_message",
                "space",
                name="contenttype",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("content_id", sa.Uuid(), nullable=False),
        sa.Column("group_id", sa.Uuid(), nullable=False),
        sa.Column("linked_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("linked_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["group_id"], ["login_groups.id"]),
        sa.ForeignKeyConstraint(["linked_by_user_id"], ["login_users.id"]),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_permissions_content_group_links_organization_id",
        "permissions_content_group_links",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        "ix_permissions_content_group_links_content_type",
        "permissions_content_group_links",
        ["content_type"],
        unique=False,
    )
    op.create_index(
        "ix_permissions_content_group_links_content_id",
        "permissions_content_group_links",
        ["content_id"],
        unique=False,
    )
    op.create_index(
        "ix_permissions_content_group_links_group_id",
        "permissions_content_group_links",
        ["group_id"],
        unique=False,
    )


def downgrade() -> None:
    """Drop permission tables."""
    op.drop_table("permissions_content_group_links")
    op.drop_table("permissions_content_permissions")
