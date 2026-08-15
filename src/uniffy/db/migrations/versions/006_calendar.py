"""Create calendar domain tables.

Revision ID: 006
Revises: 005
Create Date: 2026-01-20

Consolidates (original dates):
  - calendars, categories, events, attendees (2026-01-20)
  - event templates (2026-01-26)
  - reminders JSONB + calendar_event_reminders table (2026-02-10)
  - recurrence_id + recurrence_exceptions table (2026-03-15)
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "006"
down_revision: str | None = "005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_calendartype_enum = postgresql.ENUM(
    "PERSONAL", "WORK", "TEAM", "SHARED", name="calendartype", create_type=False
)
_recurrencepattern_enum = postgresql.ENUM(
    "NONE",
    "DAILY",
    "WEEKLY",
    "BIWEEKLY",
    "MONTHLY",
    "YEARLY",
    name="recurrencepattern",
    create_type=False,
)
_attendeestatus_enum = postgresql.ENUM(
    "PENDING", "ACCEPTED", "TENTATIVE", "DECLINED", name="attendeestatus", create_type=False
)
_attendeerole_enum = postgresql.ENUM(
    "ORGANIZER", "REQUIRED", "OPTIONAL", name="attendeerole", create_type=False
)
_access_mode_enum = postgresql.ENUM(
    "OWNER_ONLY", "EXPLICIT_MEMBERS", "OPEN_TO_ORG", name="accessmode", create_type=False
)
_content_role_enum = postgresql.ENUM(
    "OWNER",
    "ADMIN",
    "EDITOR",
    "COMMENTER",
    "VIEWER",
    "BLOCKED",
    name="contentrole",
    create_type=False,
)


def upgrade() -> None:
    """Create calendar domain tables."""
    op.create_table(
        "calendar_calendars",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("color", sa.String(50), nullable=False, server_default="#3B82F6"),
        sa.Column("is_visible", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("calendar_type", _calendartype_enum, nullable=False, server_default="PERSONAL"),
        sa.Column("access_mode", _access_mode_enum, nullable=False, server_default="OPEN_TO_ORG"),
        sa.Column("baseline_role", _content_role_enum, nullable=True, server_default="VIEWER"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["owner_id"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_calendar_calendars_calendar_type", "calendar_calendars", ["calendar_type"])
    op.create_index(
        "ix_calendar_calendars_organization_id", "calendar_calendars", ["organization_id"]
    )
    op.create_index("ix_calendar_calendars_owner_id", "calendar_calendars", ["owner_id"])
    op.create_index("ix_calendar_calendars_access_mode", "calendar_calendars", ["access_mode"])

    op.create_table(
        "calendar_categories",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("color", sa.String(50), nullable=False),
        sa.Column("icon", sa.String(50), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_calendar_categories_organization_id", "calendar_categories", ["organization_id"]
    )

    op.create_table(
        "calendar_events",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("organizer_id", sa.Uuid(), nullable=False),
        sa.Column("calendar_id", sa.Uuid(), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_all_day", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("timezone", sa.String(100), nullable=False, server_default="UTC"),
        sa.Column("location", sa.String(500), nullable=False, server_default=""),
        sa.Column("meeting_url", sa.String(2000), nullable=True),
        sa.Column("access_mode", _access_mode_enum, nullable=False, server_default="OPEN_TO_ORG"),
        sa.Column("baseline_role", _content_role_enum, nullable=True, server_default="VIEWER"),
        sa.Column("is_focus_time", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("tags", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("linked_resources", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("outgoing_references", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "recurrence_pattern",
            _recurrencepattern_enum,
            nullable=False,
            server_default="NONE",
        ),
        sa.Column("reminders", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("recurrence_id", sa.Uuid(), nullable=True),
        sa.Column("recurrence_config", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["calendar_id"], ["calendar_calendars.id"]),
        sa.ForeignKeyConstraint(["category_id"], ["calendar_categories.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["organizer_id"], ["login_users.id"]),
        sa.ForeignKeyConstraint(
            ["recurrence_id"],
            ["calendar_events.id"],
            name="fk_calendar_events_recurrence_id",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_calendar_events_calendar_id", "calendar_events", ["calendar_id"])
    op.create_index("ix_calendar_events_category_id", "calendar_events", ["category_id"])
    op.create_index("ix_calendar_events_end_time", "calendar_events", ["end_time"])
    op.create_index("ix_calendar_events_organization_id", "calendar_events", ["organization_id"])
    op.create_index("ix_calendar_events_organizer_id", "calendar_events", ["organizer_id"])
    op.create_index("ix_calendar_events_start_time", "calendar_events", ["start_time"])
    op.create_index("ix_calendar_events_access_mode", "calendar_events", ["access_mode"])
    op.create_index("ix_calendar_events_recurrence_id", "calendar_events", ["recurrence_id"])

    op.create_table(
        "calendar_event_attendees",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("status", _attendeestatus_enum, nullable=False, server_default="PENDING"),
        sa.Column("role", _attendeerole_enum, nullable=False, server_default="REQUIRED"),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["event_id"], ["calendar_events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_calendar_event_attendees_event_id", "calendar_event_attendees", ["event_id"])
    op.create_index("ix_calendar_event_attendees_user_id", "calendar_event_attendees", ["user_id"])

    op.create_table(
        "calendar_event_reminders",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("minutes_before", sa.Integer(), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["calendar_events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", "user_id", "minutes_before", name="uq_event_user_minutes"),
    )
    op.create_index("ix_calendar_event_reminders_event_id", "calendar_event_reminders", ["event_id"])
    op.create_index("ix_calendar_event_reminders_user_id", "calendar_event_reminders", ["user_id"])
    op.create_index("ix_reminders_pending", "calendar_event_reminders", ["sent_at", "scheduled_at"])

    op.create_table(
        "calendar_event_templates",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("duration_minutes", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("location", sa.String(), nullable=False, server_default=""),
        sa.Column("meeting_url", sa.String(), nullable=True),
        sa.Column("category_id", sa.Uuid(), nullable=True),
        sa.Column(
            "tags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("access_mode", _access_mode_enum, nullable=False, server_default="OPEN_TO_ORG"),
        sa.Column("baseline_role", _content_role_enum, nullable=True, server_default="VIEWER"),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["login_users.id"]),
        sa.ForeignKeyConstraint(["category_id"], ["calendar_categories.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_calendar_event_templates_organization_id",
        "calendar_event_templates",
        ["organization_id"],
    )
    op.create_index(
        "ix_calendar_event_templates_access_mode",
        "calendar_event_templates",
        ["access_mode"],
    )

    op.create_table(
        "calendar_recurrence_exceptions",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("original_date", sa.Date(), nullable=False),
        sa.Column("is_cancelled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
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
        sa.UniqueConstraint("event_id", "original_date", name="uq_recurrence_exception_event_date"),
    )
    op.create_index(
        "ix_recurrence_exceptions_event_id", "calendar_recurrence_exceptions", ["event_id"]
    )
    op.create_index(
        "ix_recurrence_exceptions_original_date",
        "calendar_recurrence_exceptions",
        ["original_date"],
    )


def downgrade() -> None:
    """Drop calendar domain tables."""
    op.drop_table("calendar_recurrence_exceptions")
    op.drop_table("calendar_event_templates")
    op.drop_table("calendar_event_reminders")
    op.drop_table("calendar_event_attendees")
    op.drop_table("calendar_events")
    op.drop_table("calendar_categories")
    op.drop_table("calendar_calendars")
