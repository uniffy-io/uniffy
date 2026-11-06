"""Add external calendar feed subscriptions."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "131"
down_revision: str | None = "130"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "calendar_subscriptions"


_OVERRIDE_INDEX = "ix_calendar_recurrence_exceptions_override_event_id"
_DELETE_FEED_DEPENDENTS = {
    "calendar_event_reminders": (
        "DELETE FROM calendar_event_reminders WHERE event_id IN ("
        "SELECT e.id FROM calendar_events e JOIN calendar_calendars c ON c.id = e.calendar_id "
        "WHERE c.calendar_type = 'SUBSCRIBED')"
    ),
    "calendar_activities": (
        "DELETE FROM calendar_activities WHERE event_id IN ("
        "SELECT e.id FROM calendar_events e JOIN calendar_calendars c ON c.id = e.calendar_id "
        "WHERE c.calendar_type = 'SUBSCRIBED')"
    ),
    "calendar_event_attendees": (
        "DELETE FROM calendar_event_attendees WHERE event_id IN ("
        "SELECT e.id FROM calendar_events e JOIN calendar_calendars c ON c.id = e.calendar_id "
        "WHERE c.calendar_type = 'SUBSCRIBED')"
    ),
}


def upgrade() -> None:
    # Legal inside the migration transaction because nothing here reads the new label.
    op.execute("ALTER TYPE calendartype ADD VALUE IF NOT EXISTS 'SUBSCRIBED'")

    op.add_column(
        "calendar_events", sa.Column("ical_fingerprint", sa.String(length=64), nullable=True)
    )

    op.create_table(
        _TABLE,
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("login_organizations.id"),
            nullable=False,
        ),
        sa.Column(
            "owner_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("login_users.id"),
            nullable=False,
        ),
        sa.Column(
            "calendar_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("calendar_calendars.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("url_encrypted", sa.Text(), nullable=False),
        sa.Column("url_digest", sa.String(length=64), nullable=False),
        sa.Column("url_host", sa.String(length=255), nullable=False),
        sa.Column("refresh_interval_minutes", sa.Integer(), nullable=False),
        sa.Column("counts_as_busy", sa.Boolean(), nullable=False),
        sa.Column("etag", sa.String(length=500), nullable=True),
        sa.Column("last_modified", sa.String(length=100), nullable=True),
        sa.Column("content_digest", sa.String(length=64), nullable=True),
        sa.Column("next_refresh_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("consecutive_failures", sa.Integer(), nullable=False),
        sa.Column("last_error_code", sa.String(length=40), nullable=True),
        sa.Column("last_error_status", sa.Integer(), nullable=True),
        sa.Column("failure_notified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("event_count", sa.Integer(), nullable=False),
        sa.Column("skipped_count", sa.Integer(), nullable=False),
        sa.Column("search_stale", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "refresh_interval_minutes >= 15", name="ck_calendar_subscriptions_interval"
        ),
    )
    op.create_index(f"ix_{_TABLE}_organization_id", _TABLE, ["organization_id"])
    op.create_index(f"ix_{_TABLE}_owner_id", _TABLE, ["owner_id"])
    op.create_index("ix_calendar_subscriptions_due", _TABLE, ["next_refresh_at"])
    op.create_index(
        "uq_calendar_subscriptions_owner_url",
        _TABLE,
        ["organization_id", "owner_id", "url_digest"],
        unique=True,
    )
    # Feed syncs delete overrides in bulk; without this every deleted event row
    # scans the whole exceptions table for references to it.
    op.create_index(
        _OVERRIDE_INDEX,
        "calendar_recurrence_exceptions",
        ["override_event_id"],
        postgresql_where=sa.text("override_event_id IS NOT NULL"),
    )


def downgrade() -> None:
    # PostgreSQL cannot drop an enum label, so 'SUBSCRIBED' stays on calendartype;
    # the rows using it are retired so the previous code never loads one.
    # The previous code cannot read this notification type.
    op.execute(
        "DELETE FROM notification_email_deliveries "
        "WHERE notification_type = 'CALENDAR_SUBSCRIPTION_FAILED'"
    )
    op.execute("DELETE FROM notifications WHERE notification_type = 'CALENDAR_SUBSCRIPTION_FAILED'")
    # Feed events are read-only, but a stray dependent row must not block their delete.
    for table in ("calendar_event_reminders", "calendar_activities", "calendar_event_attendees"):
        op.execute(_DELETE_FEED_DEPENDENTS[table])
    op.execute(
        "UPDATE rooms_bookings SET event_id = NULL WHERE event_id IN ("
        "SELECT e.id FROM calendar_events e JOIN calendar_calendars c ON c.id = e.calendar_id "
        "WHERE c.calendar_type = 'SUBSCRIBED')"
    )
    op.execute(
        "DELETE FROM calendar_recurrence_exceptions WHERE event_id IN ("
        "SELECT e.id FROM calendar_events e JOIN calendar_calendars c ON c.id = e.calendar_id "
        "WHERE c.calendar_type = 'SUBSCRIBED')"
    )
    op.execute(
        "DELETE FROM calendar_events e USING calendar_calendars c "
        "WHERE c.id = e.calendar_id AND c.calendar_type = 'SUBSCRIBED' "
        "AND e.recurrence_id IS NOT NULL"
    )
    op.execute(
        "DELETE FROM calendar_events e USING calendar_calendars c "
        "WHERE c.id = e.calendar_id AND c.calendar_type = 'SUBSCRIBED'"
    )
    op.execute(
        "UPDATE calendar_calendars SET calendar_type = 'PERSONAL', is_deleted = true, "
        "deleted_at = now() WHERE calendar_type = 'SUBSCRIBED'"
    )
    op.drop_index(_OVERRIDE_INDEX, table_name="calendar_recurrence_exceptions")
    op.drop_table(_TABLE)
    op.drop_column("calendar_events", "ical_fingerprint")
