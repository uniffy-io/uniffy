"""Install the unaccent extension for accent-insensitive memory scoring.

Revision ID: 067
Revises: 066
Create Date: 2026-07-29
"""

from collections.abc import Sequence

from alembic import op

revision: str = "067"
down_revision: str | None = "066"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")


def downgrade() -> None:
    op.execute("DROP EXTENSION IF EXISTS unaccent")
