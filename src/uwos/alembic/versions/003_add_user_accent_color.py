"""add user accent color

Revision ID: 003
Revises: 002
Create Date: 2026-01-09 00:00:00.000000

"""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
import sqlmodel
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add accent_color column to login_users table."""
    op.add_column(
        "login_users",
        sa.Column(
            "accent_color",
            sqlmodel.sql.sqltypes.AutoString(length=50),
            nullable=True,
        ),
    )


def downgrade() -> None:
    """Remove accent_color column from login_users table."""
    op.drop_column("login_users", "accent_color")
