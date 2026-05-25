"""Deployment-scope KV store + singleton DEK table.

Revision ID: 044
Revises: 043
Create Date: 2026-05-25

Two tables for deployment-wide operator configuration:

* ``deployment_settings`` -- generic ``(namespace, key)`` KV. Mirrors
  ``org_settings`` minus the org scoping. First consumer is the
  system mail config (``namespace='mail'``); future deployment knobs
  (telemetry opt-in, branding, registration policy, ...) drop in as
  new rows with no migration.
* ``deployment_encryption_keys`` -- singleton DEK rows wrapping the
  per-deployment encryption key with the master KEK. Provisioned
  lazily by :class:`DeploymentCipher` on first encrypt, so an empty
  table is the normal startup state.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "044"
down_revision: str | None = "043"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the two deployment-scope tables."""
    op.create_table(
        "deployment_settings",
        sa.Column("namespace", sa.String(length=64), nullable=False),
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column(
            "value",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("value_encrypted", sa.Text(), nullable=True),
        sa.Column(
            "is_secret",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("namespace", "key"),
        sa.ForeignKeyConstraint(
            ["updated_by_user_id"],
            ["login_users.id"],
            ondelete="SET NULL",
        ),
        sa.CheckConstraint(
            "(is_secret = true  AND value_encrypted IS NOT NULL AND value IS NULL) "
            "OR (is_secret = false AND value_encrypted IS NULL)",
            name="ck_deployment_settings_value_exclusive",
        ),
    )
    op.create_index(
        "ix_deployment_settings_namespace_secret",
        "deployment_settings",
        ["namespace", "is_secret"],
    )

    op.create_table(
        "deployment_encryption_keys",
        sa.Column("id", sa.Uuid(), nullable=False),
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
        sa.Column(
            "retired_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "version",
            name="uq_deployment_encryption_keys_version",
        ),
    )
    op.create_index(
        "ix_deployment_encryption_keys_active",
        "deployment_encryption_keys",
        ["is_active"],
        unique=False,
        postgresql_where=sa.text("is_active = true"),
    )


def downgrade() -> None:
    """Drop the deployment-scope tables."""
    op.drop_index(
        "ix_deployment_encryption_keys_active",
        table_name="deployment_encryption_keys",
    )
    op.drop_table("deployment_encryption_keys")
    op.drop_index(
        "ix_deployment_settings_namespace_secret",
        table_name="deployment_settings",
    )
    op.drop_table("deployment_settings")
