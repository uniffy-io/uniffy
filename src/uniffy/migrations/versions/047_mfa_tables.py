"""Per-user MFA tables + platform peer-co-sign requests.

Revision ID: 047
Revises: 046
Create Date: 2026-05-27

Three tables back the TOTP MFA + recovery surface:

* ``login_user_mfa`` -- one row per user that holds the (nullable)
  encrypted TOTP secret, the enabled flag, and the verify counters.
* ``login_user_recovery_codes`` -- Argon2id-hashed single-use codes
  for the lost-device path. Partial index on the active subset.
* ``platform_mfa_reset_requests`` -- peer-co-sign requests for
  resetting a platform admin's MFA. Pending rows are bounded by the
  partial expiry index.

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "047"
down_revision: str | None = "046"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the three MFA tables and their indexes."""
    op.create_table(
        "login_user_mfa",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("totp_secret_encrypted", sa.Text(), nullable=True),
        sa.Column(
            "enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("enrolled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_failed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "consecutive_failures",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
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
        sa.PrimaryKeyConstraint("user_id"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["login_users.id"],
            ondelete="CASCADE",
        ),
    )

    op.create_table(
        "login_user_recovery_codes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("code_hash", sa.Text(), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["login_users.id"],
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_login_user_recovery_codes_user_id",
        "login_user_recovery_codes",
        ["user_id"],
    )
    op.create_index(
        "ix_login_user_recovery_codes_user_active",
        "login_user_recovery_codes",
        ["user_id"],
        postgresql_where=sa.text("used_at IS NULL"),
    )

    op.create_table(
        "platform_mfa_reset_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("requester_user_id", sa.Uuid(), nullable=False),
        sa.Column("target_user_id", sa.Uuid(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approver_user_id", sa.Uuid(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["requester_user_id"],
            ["login_users.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["target_user_id"],
            ["login_users.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["approver_user_id"],
            ["login_users.id"],
            ondelete="SET NULL",
        ),
    )
    op.create_index(
        "ix_platform_mfa_reset_requests_requester",
        "platform_mfa_reset_requests",
        ["requester_user_id"],
    )
    op.create_index(
        "ix_platform_mfa_reset_requests_target",
        "platform_mfa_reset_requests",
        ["target_user_id"],
    )
    op.create_index(
        "ix_platform_mfa_reset_requests_pending",
        "platform_mfa_reset_requests",
        ["expires_at"],
        postgresql_where=sa.text("approved_at IS NULL"),
    )


def downgrade() -> None:
    """Drop the three MFA tables."""
    op.drop_index(
        "ix_platform_mfa_reset_requests_pending",
        table_name="platform_mfa_reset_requests",
    )
    op.drop_index(
        "ix_platform_mfa_reset_requests_target",
        table_name="platform_mfa_reset_requests",
    )
    op.drop_index(
        "ix_platform_mfa_reset_requests_requester",
        table_name="platform_mfa_reset_requests",
    )
    op.drop_table("platform_mfa_reset_requests")
    op.drop_index(
        "ix_login_user_recovery_codes_user_active",
        table_name="login_user_recovery_codes",
    )
    op.drop_index(
        "ix_login_user_recovery_codes_user_id",
        table_name="login_user_recovery_codes",
    )
    op.drop_table("login_user_recovery_codes")
    op.drop_table("login_user_mfa")
