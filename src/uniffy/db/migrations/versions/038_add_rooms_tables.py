"""Add rooms and bookings tables.

Revision ID: 038
Revises: 037
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import JSONB

revision = "038"
down_revision = "037"
branch_labels = None
depends_on = None

_room_type_enum = postgresql.ENUM(
    "MEETING_ROOM",
    "CONFERENCE_ROOM",
    "OFFICE",
    "OTHER",
    name="roomtype",
    create_type=False,
)

_room_status_enum = postgresql.ENUM(
    "ACTIVE",
    "MAINTENANCE",
    "RETIRED",
    name="roomstatus",
    create_type=False,
)

_booking_status_enum = postgresql.ENUM(
    "CONFIRMED",
    "CANCELLED",
    name="bookingstatus",
    create_type=False,
)

_visibility_enum = postgresql.ENUM(
    "PRIVATE",
    "GROUP",
    "ORGANIZATION",
    "PUBLIC",
    name="visibilityscope",
    create_type=False,
)


def upgrade() -> None:
    """Create rooms and bookings tables with supporting enums and indexes."""
    # Add ROOM to existing contenttype enum
    op.execute("ALTER TYPE contenttype ADD VALUE IF NOT EXISTS 'ROOM'")

    # Create new enums
    postgresql.ENUM(
        "MEETING_ROOM",
        "CONFERENCE_ROOM",
        "OFFICE",
        "OTHER",
        name="roomtype",
    ).create(op.get_bind(), checkfirst=True)

    postgresql.ENUM(
        "ACTIVE",
        "MAINTENANCE",
        "RETIRED",
        name="roomstatus",
    ).create(op.get_bind(), checkfirst=True)

    postgresql.ENUM(
        "CONFIRMED",
        "CANCELLED",
        name="bookingstatus",
    ).create(op.get_bind(), checkfirst=True)

    # Create rooms table
    op.create_table(
        "rooms_rooms",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.String(), nullable=False, server_default=""),
        sa.Column("room_type", _room_type_enum, nullable=False),
        sa.Column("status", _room_status_enum, nullable=False, server_default="ACTIVE"),
        sa.Column("capacity", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("floor", sa.String(length=50), nullable=True),
        sa.Column("building", sa.String(length=100), nullable=True),
        sa.Column("location", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("amenities", JSONB, nullable=True),
        sa.Column("image_file_id", sa.Uuid(), nullable=True),
        sa.Column("visibility", _visibility_enum, nullable=False, server_default="ORGANIZATION"),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_id"], ["login_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_rooms_rooms_organization_id", "rooms_rooms", ["organization_id"])
    op.create_index("ix_rooms_rooms_owner_id", "rooms_rooms", ["owner_id"])
    op.create_index("ix_rooms_rooms_visibility", "rooms_rooms", ["visibility"])

    # Create bookings table
    op.create_table(
        "rooms_bookings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("room_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", _booking_status_enum, nullable=False, server_default="CONFIRMED"),
        sa.Column("notes", sa.String(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["room_id"], ["rooms_rooms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["event_id"], ["calendar_events.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_rooms_bookings_room_id", "rooms_bookings", ["room_id"])
    op.create_index("ix_rooms_bookings_organization_id", "rooms_bookings", ["organization_id"])
    op.create_index("ix_rooms_bookings_user_id", "rooms_bookings", ["user_id"])
    op.create_index("ix_rooms_bookings_event_id", "rooms_bookings", ["event_id"])
    op.create_index("ix_rooms_bookings_start_time", "rooms_bookings", ["start_time"])
    op.create_index("ix_rooms_bookings_end_time", "rooms_bookings", ["end_time"])
    op.create_index(
        "ix_rooms_bookings_conflict",
        "rooms_bookings",
        ["room_id", "start_time", "end_time"],
    )


def downgrade() -> None:
    """Drop rooms and bookings tables and enums."""
    op.drop_table("rooms_bookings")
    op.drop_table("rooms_rooms")

    postgresql.ENUM(name="bookingstatus").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="roomstatus").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="roomtype").drop(op.get_bind(), checkfirst=True)
