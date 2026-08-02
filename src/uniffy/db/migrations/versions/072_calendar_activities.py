"""Per-event activity log for calendar events, including RSVP responses.

Revision ID: 072
Revises: 071
Create Date: 2026-08-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "072"
down_revision: str | None = "071"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "calendar_activities",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        sa.Column("action", sa.String(length=50), nullable=False),
        sa.Column("field_id", sa.String(length=100), nullable=True),
        sa.Column("previous_value", sa.String(), nullable=True),
        sa.Column("new_value", sa.String(), nullable=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["calendar_events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_id"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    # The log is always read newest-first for one event.
    op.create_index(
        "ix_calendar_activities_event_timestamp",
        "calendar_activities",
        ["event_id", sa.text("timestamp DESC")],
    )


def downgrade() -> None:
    op.drop_index("ix_calendar_activities_event_timestamp", table_name="calendar_activities")
    op.drop_table("calendar_activities")
