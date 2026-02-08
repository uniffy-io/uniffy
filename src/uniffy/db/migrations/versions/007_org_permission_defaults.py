"""Create organization permission defaults table.

Revision ID: 006
Revises: 005
Create Date: 2026-01-24

This migration creates the permissions_org_defaults table for storing
default permission settings per content type within each organization.

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "007"
down_revision: str | None = "006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create permissions_org_defaults table."""
    op.create_table(
        "permissions_org_defaults",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column(
            "content_type",
            postgresql.ENUM(
                "NOTE",
                "FILE",
                "CALENDAR_EVENT",
                "BOOK",
                "PASSWORD",
                "WORKFLOW",
                "CHAT_MESSAGE",
                "SPACE",
                name="contenttype",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column(
            "default_visibility",
            postgresql.ENUM(
                "PRIVATE",
                "GROUP",
                "ORGANIZATION",
                "PUBLIC",
                name="visibilityscope",
                create_type=False,
            ),
            nullable=False,
            server_default="PRIVATE",
        ),
        sa.Column("members_can_view", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("members_can_edit", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("members_can_delete", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("members_can_share", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "content_type", name="uq_org_content_type"),
    )

    op.create_index(
        "ix_permissions_org_defaults_organization_id",
        "permissions_org_defaults",
        ["organization_id"],
        unique=False,
    )


def downgrade() -> None:
    """Drop permissions_org_defaults table."""
    op.drop_index(
        "ix_permissions_org_defaults_organization_id",
        table_name="permissions_org_defaults",
    )
    op.drop_table("permissions_org_defaults")
