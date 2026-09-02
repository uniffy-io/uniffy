"""Snapshot provenance on event attendees: the group that produced the row.

Revision ID: 077
Revises: 076
Create Date: 2026-08-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "077"
down_revision: str | None = "076"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "calendar_event_attendees",
        sa.Column("invited_via_group_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_calendar_event_attendees_invited_via_group",
        "calendar_event_attendees",
        "login_groups",
        ["invited_via_group_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_calendar_event_attendees_invited_via_group",
        "calendar_event_attendees",
        type_="foreignkey",
    )
    op.drop_column("calendar_event_attendees", "invited_via_group_id")
