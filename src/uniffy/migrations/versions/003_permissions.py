"""Create permissions tables: content members, member events, org defaults, domain admins.

Revision ID: 003
Revises: 002
Create Date: 2026-01-20

Consolidates (original dates):
  - content_members + member events (2026-01-20)
  - org_defaults (2026-01-24)
  - domain_admins (2026-04-01)
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "003"
down_revision: str | None = "002"
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
    "OWNER_ONLY", "EXPLICIT_MEMBERS", "OPEN_TO_ORG", name="accessmode", create_type=False
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
_content_member_action_enum = postgresql.ENUM(
    "MEMBER_ADDED",
    "MEMBER_ROLE_CHANGED",
    "MEMBER_REMOVED",
    "ACCESS_MODE_CHANGED",
    "BASELINE_ROLE_CHANGED",
    "OWNERSHIP_TRANSFERRED",
    name="contentmemberaction",
    create_type=False,
)
_subject_type_enum = postgresql.ENUM(
    "USER", "GROUP", "ORGANIZATION", "AGENT", name="subjecttype", create_type=False
)
_organization_role_enum = postgresql.ENUM(
    "OWNER", "ADMIN", "MEMBER", name="organizationrole", create_type=False
)
_domain_type_enum = postgresql.ENUM(
    "CHAT",
    "FILES",
    "NOTES",
    "CALENDAR",
    "PROJECTS",
    "AGENTS",
    name="domaintype",
    create_type=False,
)


def upgrade() -> None:
    """Create permissions domain tables."""
    op.create_table(
        "permissions_content_members",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("content_type", _content_type_enum, nullable=False),
        sa.Column("content_id", sa.Uuid(), nullable=False),
        sa.Column("subject_type", _subject_type_enum, nullable=False),
        sa.Column("subject_id", sa.Uuid(), nullable=False),
        sa.Column("role", _content_role_enum, nullable=False),
        sa.Column("added_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["added_by_user_id"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id",
            "content_type",
            "content_id",
            "subject_type",
            "subject_id",
            name="uq_content_member_unique",
        ),
    )
    op.create_index(
        "ix_content_member_content",
        "permissions_content_members",
        ["content_type", "content_id"],
    )
    op.create_index(
        "ix_content_member_subject",
        "permissions_content_members",
        ["subject_type", "subject_id"],
    )
    op.create_index(
        "ix_content_member_org",
        "permissions_content_members",
        ["organization_id"],
    )

    op.create_table(
        "permissions_content_member_events",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("content_type", _content_type_enum, nullable=False),
        sa.Column("content_id", sa.Uuid(), nullable=False),
        sa.Column("action", _content_member_action_enum, nullable=False),
        sa.Column("subject_type", _subject_type_enum, nullable=True),
        sa.Column("subject_id", sa.Uuid(), nullable=True),
        sa.Column("previous_role", _content_role_enum, nullable=True),
        sa.Column("new_role", _content_role_enum, nullable=True),
        sa.Column("previous_access_mode", _access_mode_enum, nullable=True),
        sa.Column("new_access_mode", _access_mode_enum, nullable=True),
        sa.Column("previous_baseline_role", _content_role_enum, nullable=True),
        sa.Column("new_baseline_role", _content_role_enum, nullable=True),
        sa.Column("previous_owner_id", sa.Uuid(), nullable=True),
        sa.Column("new_owner_id", sa.Uuid(), nullable=True),
        sa.Column("actor_user_id", sa.Uuid(), nullable=False),
        sa.Column("actor_org_role", _organization_role_enum, nullable=False),
        sa.Column("note", sa.String(500), nullable=False, server_default=""),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_cme_content",
        "permissions_content_member_events",
        ["content_type", "content_id", "occurred_at"],
    )
    op.create_index(
        "ix_cme_actor",
        "permissions_content_member_events",
        ["actor_user_id", "occurred_at"],
    )
    op.create_index(
        "ix_cme_org",
        "permissions_content_member_events",
        ["organization_id", "occurred_at"],
    )

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
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "content_type", name="uq_org_content_type"),
    )
    op.create_index(
        "ix_permissions_org_defaults_organization_id",
        "permissions_org_defaults",
        ["organization_id"],
    )

    op.create_table(
        "permissions_domain_admins",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("domain", _domain_type_enum, nullable=False),
        sa.Column("granted_by", sa.Uuid(), nullable=False),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["granted_by"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "organization_id", "domain", name="uq_domain_admin_user_org_domain"
        ),
    )
    op.create_index(
        "ix_permissions_domain_admins_user_id",
        "permissions_domain_admins",
        ["user_id"],
    )
    op.create_index(
        "ix_permissions_domain_admins_organization_id",
        "permissions_domain_admins",
        ["organization_id"],
    )


def downgrade() -> None:
    """Drop permissions domain tables."""
    op.drop_table("permissions_domain_admins")
    op.drop_table("permissions_org_defaults")
    op.drop_table("permissions_content_member_events")
    op.drop_table("permissions_content_members")
