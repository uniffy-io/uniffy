"""Add avatar_key column to login_users

Revision ID: 022
Revises: 021
Create Date: 2026-02-15 00:00:00.000000

"""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "022"
down_revision: Union[str, None] = "021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add avatar_key column to login_users table."""
    op.add_column(
        "login_users",
        sa.Column("avatar_key", sa.String(length=512), nullable=True),
    )


def downgrade() -> None:
    """Remove avatar_key column from login_users table."""
    op.drop_column("login_users", "avatar_key")
