"""Add font_family to User model

Revision ID: 004
Revises: 003
Create Date: 2026-01-09

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add font_family column to login_users table."""
    op.add_column(
        "login_users",
        sa.Column(
            "font_family",
            sa.String(length=20),
            nullable=True,
            comment="User's preferred font family: 'inter', 'geist', or 'system'",
        ),
    )


def downgrade() -> None:
    """Remove font_family column from login_users table."""
    op.drop_column("login_users", "font_family")
