"""Add status, visibility, transparency, and out-of-office to calendar events.

Revision ID: 090
Revises: 089
Create Date: 2026-08-24

Transparency backfill: all-day events have never blocked time in free/busy
answers, so existing all-day rows become TRANSPARENT and timed rows OPAQUE,
making the previous implicit rule an explicit per-event field.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "090"
down_revision: str | None = "089"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_event_status_enum = postgresql.ENUM(
    "CONFIRMED",
    "TENTATIVE",
    "CANCELLED",
    name="eventstatus",
    create_type=False,
)

_event_visibility_enum = postgresql.ENUM(
    "STANDARD",
    "PRIVATE",
    name="eventvisibility",
    create_type=False,
)

_event_transparency_enum = postgresql.ENUM(
    "OPAQUE",
    "TRANSPARENT",
    name="eventtransparency",
    create_type=False,
)


def upgrade() -> None:
    postgresql.ENUM(
        "CONFIRMED",
        "TENTATIVE",
        "CANCELLED",
        name="eventstatus",
    ).create(op.get_bind(), checkfirst=True)
    postgresql.ENUM(
        "STANDARD",
        "PRIVATE",
        name="eventvisibility",
    ).create(op.get_bind(), checkfirst=True)
    postgresql.ENUM(
        "OPAQUE",
        "TRANSPARENT",
        name="eventtransparency",
    ).create(op.get_bind(), checkfirst=True)

    op.add_column(
        "calendar_events",
        sa.Column(
            "status",
            _event_status_enum,
            nullable=False,
            server_default="CONFIRMED",
        ),
    )
    op.add_column(
        "calendar_events",
        sa.Column(
            "visibility",
            _event_visibility_enum,
            nullable=False,
            server_default="STANDARD",
        ),
    )
    op.add_column(
        "calendar_events",
        sa.Column(
            "transparency",
            _event_transparency_enum,
            nullable=False,
            server_default="OPAQUE",
        ),
    )
    op.add_column(
        "calendar_events",
        sa.Column(
            "is_out_of_office",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    op.execute("UPDATE calendar_events SET transparency = 'TRANSPARENT' WHERE is_all_day")


def downgrade() -> None:
    op.drop_column("calendar_events", "is_out_of_office")
    op.drop_column("calendar_events", "transparency")
    op.drop_column("calendar_events", "visibility")
    op.drop_column("calendar_events", "status")
    postgresql.ENUM(name="eventtransparency").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="eventvisibility").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="eventstatus").drop(op.get_bind(), checkfirst=True)
