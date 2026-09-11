"""Carry an event's iCalendar identity and revision counter.

Revision ID: 099
Revises: 098
Create Date: 2026-09-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "099"
down_revision: str | None = "098"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "calendar_events"
_UID_INDEX = "uq_calendar_events_calendar_ical_uid"


def upgrade() -> None:
    op.add_column(_TABLE, sa.Column("ical_uid", sa.String(length=500), nullable=True))
    op.add_column(
        _TABLE,
        sa.Column("ical_sequence", sa.Integer(), nullable=False, server_default="0"),
    )
    # Re-importing the same file must not duplicate its events; rows created in
    # the product carry no UID and are left out of the constraint entirely.
    op.create_index(
        _UID_INDEX,
        _TABLE,
        ["calendar_id", "ical_uid"],
        unique=True,
        postgresql_where=sa.text("ical_uid IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(_UID_INDEX, table_name=_TABLE)
    op.drop_column(_TABLE, "ical_sequence")
    op.drop_column(_TABLE, "ical_uid")
