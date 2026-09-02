"""Create identity tables: users, organizations, memberships, groups, SSO, sessions.

Revision ID: 002
Revises: 001
Create Date: 2026-01-20

Final state of the identity domain. Consolidates (original dates):
  - users + orgs + memberships + groups + SSO (2026-01-20)
  - accent_color/font_family push (2026-02-09)
  - user_sessions (2026-02-10)
  - user avatar_key (2026-02-17)
  - cache_key_seed (2026-03-17)
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "002"
down_revision: str | None = "001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_organization_role_enum = postgresql.ENUM(
    "OWNER", "ADMIN", "MEMBER", name="organizationrole", create_type=False
)
_group_role_enum = postgresql.ENUM("ADMIN", "MEMBER", name="grouprole", create_type=False)
_sso_provider_enum = postgresql.ENUM(
    "SAML", "OIDC", "GOOGLE", "MICROSOFT", "OKTA", name="ssoprovider", create_type=False
)


def upgrade() -> None:
    """Create identity and access management tables."""
    op.create_table(
        "login_organizations",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(255), nullable=False),
        sa.Column("domain", sa.String(255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("plan", sa.String(50), nullable=False, server_default="free"),
        sa.Column("max_members", sa.Integer(), nullable=True),
        sa.Column("settings", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_login_organizations_slug", "login_organizations", ["slug"], unique=True)
    op.create_index("ix_login_organizations_domain", "login_organizations", ["domain"])

    op.create_table(
        "login_users",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("username", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(255), nullable=True),
        sa.Column("hashed_password", sa.String(255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("is_system_admin", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("token_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("accent_color", sa.String(50), nullable=True),
        sa.Column("font_family", sa.String(20), nullable=True),
        sa.Column("avatar_key", sa.String(512), nullable=True),
        sa.Column("cache_key_seed", sa.LargeBinary(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_login_users_email", "login_users", ["email"], unique=True)
    op.create_index("ix_login_users_username", "login_users", ["username"], unique=True)

    op.create_table(
        "login_organization_members",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("role", _organization_role_enum, nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_login_organization_members_user_id",
        "login_organization_members",
        ["user_id"],
    )
    op.create_index(
        "ix_login_organization_members_organization_id",
        "login_organization_members",
        ["organization_id"],
    )

    op.create_table(
        "login_groups",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(255), nullable=False),
        sa.Column("description", sa.String(1000), nullable=True),
        sa.Column("is_private", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["login_users.id"]),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_login_groups_organization_id", "login_groups", ["organization_id"])
    op.create_index("ix_login_groups_slug", "login_groups", ["slug"])

    op.create_table(
        "login_group_members",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("group_id", sa.Uuid(), nullable=False),
        sa.Column("role", _group_role_enum, nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["group_id"], ["login_groups.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_login_group_members_user_id", "login_group_members", ["user_id"])
    op.create_index("ix_login_group_members_group_id", "login_group_members", ["group_id"])

    op.create_table(
        "login_sso_configurations",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("provider", _sso_provider_enum, nullable=False),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("enforce_sso", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("domain", sa.String(255), nullable=False),
        sa.Column("metadata_url", sa.String(1000), nullable=True),
        sa.Column("entity_id", sa.String(500), nullable=True),
        sa.Column("sso_url", sa.String(1000), nullable=True),
        sa.Column("certificate", sa.Text(), nullable=True),
        sa.Column("client_secret", sa.Text(), nullable=True),
        sa.Column("settings", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_login_sso_configurations_organization_id",
        "login_sso_configurations",
        ["organization_id"],
        unique=True,
    )

    op.create_table(
        "login_user_sessions",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("ip_address", sa.String(45), nullable=False, server_default=""),
        sa.Column("user_agent", sa.String(512), nullable=False, server_default=""),
        sa.Column("device_label", sa.String(255), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_activity", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_revoked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_login_user_sessions_user_id", "login_user_sessions", ["user_id"])
    op.create_index(
        "ix_login_user_sessions_user_revoked",
        "login_user_sessions",
        ["user_id", "is_revoked"],
    )


def downgrade() -> None:
    """Drop identity tables."""
    op.drop_table("login_user_sessions")
    op.drop_table("login_sso_configurations")
    op.drop_table("login_group_members")
    op.drop_table("login_groups")
    op.drop_table("login_organization_members")
    op.drop_table("login_users")
    op.drop_table("login_organizations")
