"""Add event reminders system.

Adds reminders JSONB column to calendar_events and creates
calendar_event_reminders table for tracking individual reminder instances.

Revision ID: 019
Revises: 018
Create Date: 2026-02-10

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "019"
down_revision: str | None = "018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add reminders column and create event_reminders table."""
    # Add reminders JSONB column to calendar_events
    op.add_column(
        "calendar_events",
        sa.Column("reminders", JSONB, nullable=True),
    )

    # Create calendar_event_reminders table
    op.create_table(
        "calendar_event_reminders",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("minutes_before", sa.Integer(), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["calendar_events.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "event_id",
            "user_id",
            "minutes_before",
            name="uq_event_user_minutes",
        ),
    )

    # Indexes
    op.create_index(
        "ix_calendar_event_reminders_event_id",
        "calendar_event_reminders",
        ["event_id"],
    )
    op.create_index(
        "ix_calendar_event_reminders_user_id",
        "calendar_event_reminders",
        ["user_id"],
    )
    op.create_index(
        "ix_reminders_pending",
        "calendar_event_reminders",
        ["sent_at", "scheduled_at"],
    )


def downgrade() -> None:
    """Remove event reminders table and column."""
    op.drop_index("ix_reminders_pending", table_name="calendar_event_reminders")
    op.drop_index("ix_calendar_event_reminders_user_id", table_name="calendar_event_reminders")
    op.drop_index("ix_calendar_event_reminders_event_id", table_name="calendar_event_reminders")
    op.drop_table("calendar_event_reminders")
    op.drop_column("calendar_events", "reminders")
