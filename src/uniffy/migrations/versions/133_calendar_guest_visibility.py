"""Preserve provider guest-list privacy and refresh existing mirrors."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "133"
down_revision: str | None = "132"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "calendar_events",
        sa.Column("guest_list_hidden", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # Existing copies have no recorded policy. Hide rosters until the provider confirms it.
    op.execute("""
        UPDATE calendar_events SET guest_list_hidden = true
        WHERE EXISTS (
            SELECT 1 FROM calendar_event_links WHERE event_id = calendar_events.id
        )
    """)
    op.execute("UPDATE calendar_event_links SET content_fingerprint = NULL")
    op.execute("UPDATE calendar_connected_calendars SET cursor = NULL, next_sync_at = now()")


def downgrade() -> None:
    op.drop_column("calendar_events", "guest_list_hidden")
