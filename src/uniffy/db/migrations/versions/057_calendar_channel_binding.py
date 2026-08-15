"""Bind calendar events to chat channels for online meetings.

Adds ``calendar_events.channel_id`` (FK to ``chat_channels`` with ON DELETE
SET NULL so deleting a channel silently un-binds the event) and
``channel_auto_created`` (marks rooms auto-created for the event).

Revision ID: 057
Revises: 056
Create Date: 2026-07-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "057"
down_revision: str | None = "056"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "calendar_events",
        sa.Column("channel_id", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "calendar_events",
        sa.Column(
            "channel_auto_created",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.create_index(
        "ix_calendar_events_channel_id",
        "calendar_events",
        ["channel_id"],
    )
    op.create_foreign_key(
        "fk_calendar_events_channel_id",
        "calendar_events",
        "chat_channels",
        ["channel_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_calendar_events_channel_id", "calendar_events", type_="foreignkey")
    op.drop_index("ix_calendar_events_channel_id", table_name="calendar_events")
    op.drop_column("calendar_events", "channel_auto_created")
    op.drop_column("calendar_events", "channel_id")
