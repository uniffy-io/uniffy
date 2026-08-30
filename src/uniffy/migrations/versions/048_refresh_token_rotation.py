"""Refresh-token rotation + reuse-detection hash columns on user sessions.

Revision ID: 048
Revises: 047
Create Date: 2026-05-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "048"
down_revision: str | None = "047"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "login_user_sessions",
        sa.Column("refresh_token_hash", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "login_user_sessions",
        sa.Column("previous_refresh_token_hash", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "login_user_sessions",
        sa.Column(
            "previous_refresh_rotated_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("login_user_sessions", "previous_refresh_rotated_at")
    op.drop_column("login_user_sessions", "previous_refresh_token_hash")
    op.drop_column("login_user_sessions", "refresh_token_hash")
