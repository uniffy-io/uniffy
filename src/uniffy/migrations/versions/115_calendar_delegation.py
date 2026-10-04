"""Calendar delegation.

Revision ID: 109
Revises: 108
Create Date: 2026-10-03

Adds ``calendar_delegations``, where a member lets a colleague act on their personal calendars,
and the attribution columns that record who acted for whom: the arranger of an event, the
delegate who answered for an attendee, and the person an activity entry was done on behalf of.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "115"
down_revision: str | None = "114"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_LEVEL_VALUES = ("EVENTS", "EVENTS_AND_PRIVATE")
_level_enum = postgresql.ENUM(*_LEVEL_VALUES, name="calendardelegationlevel", create_type=False)

_ATTRIBUTION_COLUMNS = (
    ("calendar_events", "arranged_by_id"),
    ("calendar_event_attendees", "responded_by_id"),
    ("calendar_activities", "on_behalf_of_id"),
)


def upgrade() -> None:
    postgresql.ENUM(*_LEVEL_VALUES, name="calendardelegationlevel").create(
        op.get_bind(), checkfirst=True
    )
    op.create_table(
        "calendar_delegations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "organization_id",
            sa.Uuid(),
            sa.ForeignKey("login_organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "grantor_id",
            sa.Uuid(),
            sa.ForeignKey("login_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "delegate_id",
            sa.Uuid(),
            sa.ForeignKey("login_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("level", _level_enum, nullable=False),
        sa.Column(
            "created_by_id",
            sa.Uuid(),
            sa.ForeignKey("login_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "organization_id", "grantor_id", "delegate_id", name="uq_calendar_delegations_pair"
        ),
        sa.CheckConstraint("grantor_id <> delegate_id", name="ck_calendar_delegations_not_self"),
    )
    op.create_index(
        "ix_calendar_delegations_delegate",
        "calendar_delegations",
        ["organization_id", "delegate_id"],
    )
    op.create_index(
        "ix_calendar_delegations_created",
        "calendar_delegations",
        ["organization_id", "created_at", "id"],
    )

    # The org admin's shared-calendar list pages newest first.
    op.create_index(
        "ix_calendar_calendars_org_created",
        "calendar_calendars",
        ["organization_id", "created_at", "id"],
        postgresql_where=sa.text("NOT is_deleted"),
    )

    for table, column in _ATTRIBUTION_COLUMNS:
        op.add_column(
            table,
            sa.Column(
                column,
                sa.Uuid(),
                sa.ForeignKey("login_users.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )


def downgrade() -> None:
    op.drop_index("ix_calendar_calendars_org_created", table_name="calendar_calendars")
    for table, column in _ATTRIBUTION_COLUMNS:
        op.drop_column(table, column)
    op.drop_table("calendar_delegations")
    postgresql.ENUM(name="calendardelegationlevel").drop(op.get_bind(), checkfirst=True)
