"""Create organization permission defaults table.

Revision ID: 007
Revises: 006
Create Date: 2026-01-24

Creates ``permissions_org_defaults``: templates for new content per
content type. When a user creates a note, project, etc., the backend
reads the row for that (organization, content_type) and applies the
stored ``default_access_mode`` and ``default_baseline_role`` to the new
item.

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "007"
down_revision: str | None = "006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_content_type_enum = postgresql.ENUM(
    "NOTE",
    "FILE",
    "FOLDER",
    "CALENDAR_EVENT",
    "CHAT_MESSAGE",
    "USER",
    "PROJECT",
    "TASK",
    "AGENT",
    "PROVIDER_KEY",
    "PROMPT",
    "AGENT_CRON_TASK",
    "CHAT",
    "ROOM",
    name="contenttype",
    create_type=False,
)
_access_mode_enum = postgresql.ENUM(
    "OWNER_ONLY",
    "EXPLICIT_MEMBERS",
    "OPEN_TO_ORG",
    name="accessmode",
    create_type=False,
)
_content_role_enum = postgresql.ENUM(
    "OWNER",
    "ADMIN",
    "EDITOR",
    "COMMENTER",
    "VIEWER",
    "BLOCKED",
    name="contentrole",
    create_type=False,
)


def upgrade() -> None:
    """Create permissions_org_defaults table."""
    op.create_table(
        "permissions_org_defaults",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("content_type", _content_type_enum, nullable=False),
        sa.Column(
            "default_access_mode",
            _access_mode_enum,
            nullable=False,
            server_default="OWNER_ONLY",
        ),
        sa.Column("default_baseline_role", _content_role_enum, nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["login_organizations.id"], ondelete="CASCADE"
        ),
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
