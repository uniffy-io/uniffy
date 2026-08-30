"""Create ``org_encryption_keys`` table for envelope encryption.

Revision ID: 041
Revises: 040
Create Date: 2026-05-21

Schema-only migration: creates the table that holds wrapped per-org
Data Encryption Keys plus the partial unique index that guarantees
exactly one active version per organization. No data backfill -- DEKs
are provisioned by ``OrganizationOperations.create`` for every org
created from this point onward, and the deployment is fresh.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "041"
down_revision: str | None = "040"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``org_encryption_keys`` and supporting indexes."""
    op.create_table(
        "org_encryption_keys",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("wrapped_dek", sa.Text(), nullable=False),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column(
            "retired_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["login_organizations.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["login_users.id"],
            ondelete="SET NULL",
        ),
        sa.UniqueConstraint(
            "organization_id",
            "version",
            name="uq_org_encryption_keys_org_version",
        ),
    )
    op.create_index(
        "ix_org_encryption_keys_organization_id",
        "org_encryption_keys",
        ["organization_id"],
    )
    op.create_index(
        "uq_org_encryption_keys_one_active",
        "org_encryption_keys",
        ["organization_id"],
        unique=True,
        postgresql_where=sa.text("is_active = true"),
    )


def downgrade() -> None:
    """Drop the table. All wrapped DEKs are lost; ciphertexts become unreadable."""
    op.drop_index(
        "uq_org_encryption_keys_one_active",
        table_name="org_encryption_keys",
    )
    op.drop_index(
        "ix_org_encryption_keys_organization_id",
        table_name="org_encryption_keys",
    )
    op.drop_table("org_encryption_keys")
