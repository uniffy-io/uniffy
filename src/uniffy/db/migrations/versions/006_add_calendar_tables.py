"""Add calendar tables

Revision ID: 006
Revises: 005
Create Date: 2026-01-20 20:24:54.652682

"""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
import sqlmodel
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Define enums as module-level so they can be reused in column definitions
calendartype_enum = postgresql.ENUM(
    "PERSONAL", "WORK", "TEAM", "SHARED", name="calendartype", create_type=False
)
recurrencepattern_enum = postgresql.ENUM(
    "NONE",
    "DAILY",
    "WEEKLY",
    "BIWEEKLY",
    "MONTHLY",
    "YEARLY",
    name="recurrencepattern",
    create_type=False,
)
attendeestatus_enum = postgresql.ENUM(
    "PENDING", "ACCEPTED", "TENTATIVE", "DECLINED", name="attendeestatus", create_type=False
)
attendeerole_enum = postgresql.ENUM(
    "ORGANIZER", "REQUIRED", "OPTIONAL", name="attendeerole", create_type=False
)
# Reuse existing access model enums
accessmode_enum = postgresql.ENUM(
    "OWNER_ONLY",
    "EXPLICIT_MEMBERS",
    "OPEN_TO_ORG",
    name="accessmode",
    create_type=False,
)
contentrole_enum = postgresql.ENUM(
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
    """Upgrade database schema."""
    # Create new enums
    calendartype_enum.create(op.get_bind(), checkfirst=True)
    recurrencepattern_enum.create(op.get_bind(), checkfirst=True)
    attendeestatus_enum.create(op.get_bind(), checkfirst=True)
    attendeerole_enum.create(op.get_bind(), checkfirst=True)

    # Create calendar_calendars table
    op.create_table(
        "calendar_calendars",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(length=200), nullable=False),
        sa.Column("color", sqlmodel.sql.sqltypes.AutoString(length=50), nullable=False),
        sa.Column("is_visible", sa.Boolean(), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False),
        sa.Column("calendar_type", calendartype_enum, nullable=False),
        sa.Column(
            "access_mode", accessmode_enum, nullable=False, server_default="OPEN_TO_ORG"
        ),
        sa.Column(
            "baseline_role", contentrole_enum, nullable=True, server_default="VIEWER"
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["owner_id"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_calendar_calendars_calendar_type", "calendar_calendars", ["calendar_type"], unique=False
    )
    op.create_index(
        "ix_calendar_calendars_organization_id",
        "calendar_calendars",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        "ix_calendar_calendars_owner_id", "calendar_calendars", ["owner_id"], unique=False
    )

    # Create calendar_categories table
    op.create_table(
        "calendar_categories",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(length=100), nullable=False),
        sa.Column("color", sqlmodel.sql.sqltypes.AutoString(length=50), nullable=False),
        sa.Column("icon", sqlmodel.sql.sqltypes.AutoString(length=50), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_calendar_categories_organization_id",
        "calendar_categories",
        ["organization_id"],
        unique=False,
    )

    # Create calendar_events table
    op.create_table(
        "calendar_events",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("organizer_id", sa.Uuid(), nullable=False),
        sa.Column("calendar_id", sa.Uuid(), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=True),
        sa.Column("title", sqlmodel.sql.sqltypes.AutoString(length=500), nullable=False),
        sa.Column("description", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_all_day", sa.Boolean(), nullable=False),
        sa.Column("timezone", sqlmodel.sql.sqltypes.AutoString(length=100), nullable=False),
        sa.Column("location", sqlmodel.sql.sqltypes.AutoString(length=500), nullable=False),
        sa.Column("meeting_url", sqlmodel.sql.sqltypes.AutoString(length=2000), nullable=True),
        sa.Column(
            "access_mode", accessmode_enum, nullable=False, server_default="OPEN_TO_ORG"
        ),
        sa.Column(
            "baseline_role", contentrole_enum, nullable=True, server_default="VIEWER"
        ),
        sa.Column("is_focus_time", sa.Boolean(), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False),
        sa.Column("tags", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("linked_resources", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("outgoing_references", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("recurrence_pattern", recurrencepattern_enum, nullable=False),
        sa.Column("recurrence_config", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["calendar_id"], ["calendar_calendars.id"]),
        sa.ForeignKeyConstraint(["category_id"], ["calendar_categories.id"]),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["organizer_id"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_calendar_events_calendar_id", "calendar_events", ["calendar_id"])
    op.create_index("ix_calendar_events_category_id", "calendar_events", ["category_id"])
    op.create_index("ix_calendar_events_end_time", "calendar_events", ["end_time"])
    op.create_index("ix_calendar_events_organization_id", "calendar_events", ["organization_id"])
    op.create_index("ix_calendar_events_organizer_id", "calendar_events", ["organizer_id"])
    op.create_index("ix_calendar_events_start_time", "calendar_events", ["start_time"])
    op.create_index("ix_calendar_events_access_mode", "calendar_events", ["access_mode"])

    # Create calendar_event_attendees table
    op.create_table(
        "calendar_event_attendees",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("status", attendeestatus_enum, nullable=False),
        sa.Column("role", attendeerole_enum, nullable=False),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["event_id"], ["calendar_events.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_calendar_event_attendees_event_id", "calendar_event_attendees", ["event_id"])
    op.create_index("ix_calendar_event_attendees_user_id", "calendar_event_attendees", ["user_id"])


def downgrade() -> None:
    """Downgrade database schema."""
    # Drop calendar_event_attendees table
    op.drop_index("ix_calendar_event_attendees_user_id", table_name="calendar_event_attendees")
    op.drop_index("ix_calendar_event_attendees_event_id", table_name="calendar_event_attendees")
    op.drop_table("calendar_event_attendees")

    # Drop calendar_events table
    op.drop_index("ix_calendar_events_access_mode", table_name="calendar_events")
    op.drop_index("ix_calendar_events_start_time", table_name="calendar_events")
    op.drop_index("ix_calendar_events_organizer_id", table_name="calendar_events")
    op.drop_index("ix_calendar_events_organization_id", table_name="calendar_events")
    op.drop_index("ix_calendar_events_end_time", table_name="calendar_events")
    op.drop_index("ix_calendar_events_category_id", table_name="calendar_events")
    op.drop_index("ix_calendar_events_calendar_id", table_name="calendar_events")
    op.drop_table("calendar_events")

    # Drop calendar_categories table
    op.drop_index("ix_calendar_categories_organization_id", table_name="calendar_categories")
    op.drop_table("calendar_categories")

    # Drop calendar_calendars table
    op.drop_index("ix_calendar_calendars_owner_id", table_name="calendar_calendars")
    op.drop_index("ix_calendar_calendars_organization_id", table_name="calendar_calendars")
    op.drop_index("ix_calendar_calendars_calendar_type", table_name="calendar_calendars")
    op.drop_table("calendar_calendars")

    # Drop enums
    attendeerole_enum.drop(op.get_bind(), checkfirst=True)
    attendeestatus_enum.drop(op.get_bind(), checkfirst=True)
    recurrencepattern_enum.drop(op.get_bind(), checkfirst=True)
    calendartype_enum.drop(op.get_bind(), checkfirst=True)
