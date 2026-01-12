"""Create identity tables: users, organizations, memberships, groups, SSO.

Revision ID: 002
Revises: 001
Create Date: 2026-01-12

"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "002"
down_revision: str | None = "001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create identity and access management tables."""
    # Organizations
    op.create_table(
        "login_organizations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column("slug", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column("domain", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "plan",
            sqlmodel.sql.sqltypes.AutoString(length=50),
            nullable=False,
            server_default="'free'",
        ),
        sa.Column("max_members", sa.Integer(), nullable=True),
        sa.Column("settings", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_login_organizations_slug", "login_organizations", ["slug"], unique=True)
    op.create_index("ix_login_organizations_domain", "login_organizations", ["domain"], unique=False)

    # Users
    op.create_table(
        "login_users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column("username", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column("full_name", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=True),
        sa.Column("hashed_password", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("is_system_admin", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("email_verified", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("accent_color", sqlmodel.sql.sqltypes.AutoString(length=50), nullable=True),
        sa.Column("font_family", sqlmodel.sql.sqltypes.AutoString(length=20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_login_users_email", "login_users", ["email"], unique=True)
    op.create_index("ix_login_users_username", "login_users", ["username"], unique=True)

    # Organization Members
    op.create_table(
        "login_organization_members",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column(
            "role",
            postgresql.ENUM("owner", "admin", "member", name="organizationrole", create_type=False),
            nullable=False,
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
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
        unique=False,
    )
    op.create_index(
        "ix_login_organization_members_organization_id",
        "login_organization_members",
        ["organization_id"],
        unique=False,
    )

    # Groups
    op.create_table(
        "login_groups",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column("slug", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column("description", sqlmodel.sql.sqltypes.AutoString(length=1000), nullable=True),
        sa.Column("is_private", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["login_users.id"]),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_login_groups_organization_id", "login_groups", ["organization_id"], unique=False
    )
    op.create_index("ix_login_groups_slug", "login_groups", ["slug"], unique=False)

    # Group Members
    op.create_table(
        "login_group_members",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("group_id", sa.Uuid(), nullable=False),
        sa.Column(
            "role",
            postgresql.ENUM("admin", "member", name="grouprole", create_type=False),
            nullable=False,
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["group_id"], ["login_groups.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_login_group_members_user_id", "login_group_members", ["user_id"], unique=False
    )
    op.create_index(
        "ix_login_group_members_group_id", "login_group_members", ["group_id"], unique=False
    )

    # SSO Configurations
    op.create_table(
        "login_sso_configurations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column(
            "provider",
            postgresql.ENUM(
                "saml", "oidc", "google", "microsoft", "okta", name="ssoprovider", create_type=False
            ),
            nullable=False,
        ),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("enforce_sso", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("domain", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column("metadata_url", sqlmodel.sql.sqltypes.AutoString(length=1000), nullable=True),
        sa.Column("entity_id", sqlmodel.sql.sqltypes.AutoString(length=500), nullable=True),
        sa.Column("sso_url", sqlmodel.sql.sqltypes.AutoString(length=1000), nullable=True),
        sa.Column("certificate", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("client_secret", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
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


def downgrade() -> None:
    """Drop identity tables."""
    op.drop_table("login_sso_configurations")
    op.drop_table("login_group_members")
    op.drop_table("login_groups")
    op.drop_table("login_organization_members")
    op.drop_table("login_users")
    op.drop_table("login_organizations")
