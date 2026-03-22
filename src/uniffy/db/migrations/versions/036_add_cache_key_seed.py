"""Add cache_key_seed column to login_users for client-side storage encryption

Revision ID: 036
Revises: 035
Create Date: 2026-03-21 00:00:00.000000

"""

import os
from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "036"
down_revision: Union[str, None] = "035"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add cache_key_seed column to login_users table."""
    # Add as nullable first
    op.add_column(
        "login_users",
        sa.Column("cache_key_seed", sa.LargeBinary(32), nullable=True),
    )

    # Backfill existing rows with random 32-byte seeds
    conn = op.get_bind()
    users = conn.execute(sa.text("SELECT id FROM login_users WHERE cache_key_seed IS NULL"))
    for (user_id,) in users:
        conn.execute(
            sa.text("UPDATE login_users SET cache_key_seed = :seed WHERE id = :uid"),
            {"seed": os.urandom(32), "uid": user_id},
        )

    # Make non-nullable after backfill
    op.alter_column("login_users", "cache_key_seed", nullable=False)


def downgrade() -> None:
    """Remove cache_key_seed column from login_users table."""
    op.drop_column("login_users", "cache_key_seed")
