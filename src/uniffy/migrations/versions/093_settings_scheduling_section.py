"""Add the scheduling JSONB section to settings_profiles."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "093"
down_revision: str | None = "092"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "settings_profiles",
        sa.Column("scheduling", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("settings_profiles", "scheduling")
