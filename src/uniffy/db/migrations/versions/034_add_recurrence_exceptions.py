"""Add recurrence_id to calendar_events and create calendar_recurrence_exceptions table.

Revision ID: 034
Revises: 033
"""

import sqlalchemy as sa
from alembic import op

revision = "034"
down_revision = "033"


def upgrade() -> None:
    """Add recurrence support: recurrence_id column and exceptions table."""
    # Add recurrence_id to calendar_events (self-referential FK for override instances)
    op.add_column(
        "calendar_events",
        sa.Column("recurrence_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_calendar_events_recurrence_id",
        "calendar_events",
        "calendar_events",
        ["recurrence_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_calendar_events_recurrence_id",
        "calendar_events",
        ["recurrence_id"],
    )

    # Create recurrence exceptions table
    op.create_table(
        "calendar_recurrence_exceptions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("original_date", sa.Date(), nullable=False),
        sa.Column("is_cancelled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("override_event_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["calendar_events.id"],
            name="fk_recurrence_exceptions_event_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["override_event_id"],
            ["calendar_events.id"],
            name="fk_recurrence_exceptions_override_event_id",
            ondelete="SET NULL",
        ),
        sa.UniqueConstraint(
            "event_id",
            "original_date",
            name="uq_recurrence_exception_event_date",
        ),
    )
    op.create_index(
        "ix_recurrence_exceptions_event_id",
        "calendar_recurrence_exceptions",
        ["event_id"],
    )
    op.create_index(
        "ix_recurrence_exceptions_original_date",
        "calendar_recurrence_exceptions",
        ["original_date"],
    )


def downgrade() -> None:
    """Remove recurrence exceptions table and recurrence_id column."""
    op.drop_table("calendar_recurrence_exceptions")
    op.drop_index("ix_calendar_events_recurrence_id", table_name="calendar_events")
    op.drop_constraint(
        "fk_calendar_events_recurrence_id",
        "calendar_events",
        type_="foreignkey",
    )
    op.drop_column("calendar_events", "recurrence_id")
