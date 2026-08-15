"""Create rooms + bookings domain tables.

Revision ID: 010
Revises: 009
Create Date: 2026-04-10

rooms_rooms + rooms_bookings (original 2026-04-10).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "010"
down_revision: str | None = "009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_room_type_enum = postgresql.ENUM(
    "MEETING_ROOM", "CONFERENCE_ROOM", "OFFICE", "OTHER", name="roomtype", create_type=False
)
_room_status_enum = postgresql.ENUM(
    "ACTIVE", "MAINTENANCE", "RETIRED", name="roomstatus", create_type=False
)
_booking_status_enum = postgresql.ENUM(
    "CONFIRMED", "CANCELLED", name="bookingstatus", create_type=False
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
    """Create rooms domain tables."""
    op.create_table(
        "rooms_rooms",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("room_type", _room_type_enum, nullable=False),
        sa.Column("status", _room_status_enum, nullable=False, server_default="ACTIVE"),
        sa.Column("capacity", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("floor", sa.String(50), nullable=True),
        sa.Column("building", sa.String(100), nullable=True),
        sa.Column("location", sa.String(500), nullable=False, server_default=""),
        sa.Column("amenities", postgresql.JSONB(), nullable=True),
        sa.Column("image_file_id", sa.Uuid(), nullable=True),
        sa.Column("access_mode", _access_mode_enum, nullable=False, server_default="OPEN_TO_ORG"),
        sa.Column("baseline_role", _content_role_enum, nullable=True, server_default="VIEWER"),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_id"], ["login_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_rooms_rooms_organization_id", "rooms_rooms", ["organization_id"])
    op.create_index("ix_rooms_rooms_owner_id", "rooms_rooms", ["owner_id"])
    op.create_index("ix_rooms_rooms_access_mode", "rooms_rooms", ["access_mode"])

    op.create_table(
        "rooms_bookings",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("room_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.String(500), nullable=False, server_default=""),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", _booking_status_enum, nullable=False, server_default="CONFIRMED"),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
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
    """Drop rooms domain tables."""
    op.drop_table("rooms_bookings")
    op.drop_table("rooms_rooms")
