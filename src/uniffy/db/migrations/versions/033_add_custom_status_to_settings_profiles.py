"""Add custom_status JSONB column to settings_profiles.

Revision ID: 033
Revises: 032
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "033"
down_revision = "032"


def upgrade() -> None:
    op.add_column(
        "settings_profiles",
        sa.Column("custom_status", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("settings_profiles", "custom_status")
