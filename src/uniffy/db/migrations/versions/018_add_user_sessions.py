"""Add user sessions table for per-session tracking.

Revision ID: 018
Revises: 017
Create Date: 2026-02-10

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "018"
down_revision: str | None = "017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create login_user_sessions table."""
    op.create_table(
        "login_user_sessions",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("login_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ip_address", sa.String(45), nullable=False, server_default=""),
        sa.Column("user_agent", sa.String(512), nullable=False, server_default=""),
        sa.Column("device_label", sa.String(255), nullable=False, server_default=""),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "last_activity",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("is_revoked", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_index(
        "ix_login_user_sessions_user_id",
        "login_user_sessions",
        ["user_id"],
    )
    op.create_index(
        "ix_login_user_sessions_user_id_active",
        "login_user_sessions",
        ["user_id", "is_revoked"],
    )


def downgrade() -> None:
    """Drop login_user_sessions table."""
    op.drop_index("ix_login_user_sessions_user_id_active", table_name="login_user_sessions")
    op.drop_index("ix_login_user_sessions_user_id", table_name="login_user_sessions")
    op.drop_table("login_user_sessions")
