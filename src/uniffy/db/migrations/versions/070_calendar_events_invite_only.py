"""Calendar events become invite-only: force OWNER_ONLY on every event row
and drop the now-unused CALENDAR_EVENT org permission default.

Revision ID: 070
Revises: 069
Create Date: 2026-07-31
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "070"
down_revision: str | None = "069"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE calendar_events "
            "SET access_mode = 'OWNER_ONLY', baseline_role = NULL "
            "WHERE access_mode IS DISTINCT FROM 'OWNER_ONLY' "
            "OR baseline_role IS NOT NULL"
        )
    )
    op.execute(
        sa.text(
            "DELETE FROM permissions_org_defaults "
            "WHERE content_type = 'CALENDAR_EVENT'"
        )
    )


def downgrade() -> None:
    pass
