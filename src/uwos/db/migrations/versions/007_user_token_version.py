"""Add token_version column to login_users for token revocation.

Revision ID: 007
Revises: 006
Create Date: 2026-01-19

This migration adds a token_version field to users for immediate token revocation.
When a user is deactivated or a security event occurs, this version is incremented.
Tokens containing an old version are rejected during refresh.

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "007"
down_revision: str | None = "006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add token_version column to login_users."""
    op.add_column(
        "login_users",
        sa.Column("token_version", sa.Integer(), nullable=False, server_default="1"),
    )


def downgrade() -> None:
    """Remove token_version column from login_users."""
    op.drop_column("login_users", "token_version")
