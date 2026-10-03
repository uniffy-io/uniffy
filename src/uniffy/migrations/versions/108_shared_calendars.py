"""Make calendars shareable content.

Revision ID: 108
Revises: 107
Create Date: 2026-09-28

Adds ``CALENDAR`` to ``contenttype`` so calendars can carry member rows, pins every existing
calendar to ``OWNER_ONLY`` so no organization default can open a personal calendar once calendar
access resolves, adds soft delete and a description, keeps one default calendar per member, and
stores each member's own visibility choice per calendar. A durable queue records calendars whose
events' search ACLs must be refreshed after a sharing change.

Edited occurrences are re-pointed at their series' calendar, since access and the search refresh
resolve a series through one calendar, and the old column defaults that opened any calendar inserted
without a policy to the whole organization are dropped.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "108"
down_revision: str | None = "107"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_DEFAULT_INDEX = "uq_calendar_calendars_default"
_EVENTS_BY_CALENDAR_INDEX = "ix_calendar_events_calendar_live"

# Tables whose rows name a content type; a downgrade removes the calendar ones,
# which the previous code cannot load.
_CONTENT_TYPE_COLUMNS = (
    ("attachments_attachments", "content_type"),
    ("bookmarks", "content_type"),
    ("chat_channel_resources", "content_type"),
    ("comments_comments", "content_type"),
    ("permissions_content_access_requests", "canonical_content_type"),
    ("permissions_content_access_requests", "original_content_type"),
    ("permissions_content_members", "content_type"),
    ("permissions_org_defaults", "content_type"),
    ("realtime_yjs_snapshots", "content_type"),
)


def upgrade() -> None:
    # Legal inside the migration transaction because no statement here uses the
    # new label; PostgreSQL only forbids reading a label added in the same
    # transaction.
    op.execute("ALTER TYPE contenttype ADD VALUE IF NOT EXISTS 'CALENDAR'")

    op.execute("UPDATE calendar_calendars SET access_mode = 'OWNER_ONLY' WHERE access_mode IS NULL")
    op.alter_column("calendar_calendars", "access_mode", server_default=None)
    op.alter_column("calendar_calendars", "baseline_role", server_default=None)

    op.execute(
        """
        UPDATE calendar_events AS occurrence
        SET calendar_id = master.calendar_id
        FROM calendar_events AS master
        WHERE occurrence.recurrence_id = master.id
          AND occurrence.calendar_id <> master.calendar_id
        """
    )
    op.create_index(
        _EVENTS_BY_CALENDAR_INDEX,
        "calendar_events",
        ["calendar_id", "id"],
        postgresql_where=sa.text("NOT is_deleted"),
    )

    op.add_column(
        "calendar_calendars",
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
    )
    op.add_column(
        "calendar_calendars",
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "calendar_calendars",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Concurrent first requests could each create a default. The oldest keeps the
    # flag; the others stay as ordinary calendars with their events, so nothing moves.
    op.execute(
        """
        UPDATE calendar_calendars AS c
        SET is_default = false
        FROM (
            SELECT id,
                   row_number() OVER (
                       PARTITION BY organization_id, owner_id
                       ORDER BY created_at, id
                   ) AS position
            FROM calendar_calendars
            WHERE is_default
        ) AS ranked
        WHERE c.id = ranked.id AND ranked.position > 1
        """
    )
    op.create_index(
        _DEFAULT_INDEX,
        "calendar_calendars",
        ["organization_id", "owner_id"],
        unique=True,
        postgresql_where=sa.text("is_default AND NOT is_deleted"),
    )

    op.create_table(
        "calendar_member_settings",
        sa.Column(
            "calendar_id",
            sa.Uuid(),
            sa.ForeignKey("calendar_calendars.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("login_users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "organization_id",
            sa.Uuid(),
            sa.ForeignKey("login_organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("is_hidden", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_calendar_member_settings_organization_id",
        "calendar_member_settings",
        ["organization_id"],
    )

    op.create_table(
        "calendar_search_acl_refresh_queue",
        sa.Column(
            "calendar_id",
            sa.Uuid(),
            sa.ForeignKey("calendar_calendars.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "organization_id",
            sa.Uuid(),
            sa.ForeignKey("login_organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_calendar_search_acl_refresh_created",
        "calendar_search_acl_refresh_queue",
        ["created_at"],
    )


def downgrade() -> None:
    # PostgreSQL cannot drop an enum label, and OWNER_ONLY is what a NULL policy
    # resolved to for calendars, so the label and the backfill both stay. Rows
    # that name the label go, and so do emptied deleted calendars, which would
    # otherwise come back as live ones; one still holding deleted events stays.
    for table, column in _CONTENT_TYPE_COLUMNS:
        op.execute(f"DELETE FROM {table} WHERE {column} = 'CALENDAR'")  # noqa: S608
    op.execute(
        """
        DELETE FROM calendar_calendars AS c
        WHERE c.is_deleted
          AND NOT EXISTS (SELECT 1 FROM calendar_events AS e WHERE e.calendar_id = c.id)
        """
    )
    op.drop_index(_EVENTS_BY_CALENDAR_INDEX, table_name="calendar_events", if_exists=True)
    op.drop_table("calendar_search_acl_refresh_queue")
    op.drop_table("calendar_member_settings")
    op.drop_index(_DEFAULT_INDEX, table_name="calendar_calendars")
    op.drop_column("calendar_calendars", "deleted_at")
    op.drop_column("calendar_calendars", "is_deleted")
    op.drop_column("calendar_calendars", "description")
