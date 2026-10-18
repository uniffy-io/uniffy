"""Snapshot organization participant limits on calls."""

import sqlalchemy as sa
from alembic import op

revision: str = "113"
down_revision: str | None = "112"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "calls_calls",
        sa.Column("max_participants", sa.Integer(), nullable=False, server_default="50"),
    )
    op.execute(
        """
        UPDATE calls_calls AS call
        SET max_participants = (settings.value ->> 'max_participants')::integer
        FROM org_settings AS settings
        WHERE settings.organization_id = call.organization_id
          AND settings.namespace = 'calls'
          AND settings.key = 'policy'
          AND settings.value ->> 'max_participants' IS NOT NULL
        """
    )
    op.alter_column("calls_calls", "max_participants", server_default=None)


def downgrade() -> None:
    op.drop_column("calls_calls", "max_participants")
