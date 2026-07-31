"""Org-wide encrypted credentials for external integrations (GitHub, GitLab, ...).

Revision ID: 068
Revises: 067
Create Date: 2026-07-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "068"
down_revision: str | None = "067"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "integrations_connections",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("organization_id", UUID(as_uuid=True), nullable=False),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("base_url", sa.String(length=512), nullable=True),
        sa.Column("encrypted_credential", sa.Text(), nullable=False),
        sa.Column("credential_hint", sa.String(length=20), nullable=False),
        sa.Column("account_login", sa.String(length=255), nullable=True),
        sa.Column("allow_writes", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("is_valid", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("last_validated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_by", UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["login_users.id"]),
        sa.UniqueConstraint(
            "organization_id",
            "provider",
            "name",
            name="uq_integrations_connections_org_provider_name",
        ),
    )
    op.create_index(
        "ix_integrations_connections_organization_id",
        "integrations_connections",
        ["organization_id"],
    )
    op.create_index(
        "ix_integrations_connections_active",
        "integrations_connections",
        ["organization_id"],
        postgresql_where=sa.text("is_valid = true AND is_enabled = true"),
    )


def downgrade() -> None:
    op.drop_index("ix_integrations_connections_active", table_name="integrations_connections")
    op.drop_index(
        "ix_integrations_connections_organization_id",
        table_name="integrations_connections",
    )
    op.drop_table("integrations_connections")
