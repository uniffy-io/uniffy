"""Carry iCalendar identity, feed tokens, and calendar-composed event mail.

Revision ID: 099
Revises: 098
Create Date: 2026-09-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "099"
down_revision: str | None = "098"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_EVENTS = "calendar_events"
_UID_INDEX = "uq_calendar_events_calendar_ical_uid"

_TOKENS = "calendar_feed_tokens"
_TOKEN_OWNER_INDEX = "uq_calendar_feed_tokens_calendar_user"

_DELIVERIES = "notification_email_deliveries"
_COALESCE_INDEX = "uq_notification_email_deliveries_coalesce"


def upgrade() -> None:
    op.add_column(_EVENTS, sa.Column("ical_uid", sa.String(length=500), nullable=True))
    op.add_column(
        _EVENTS,
        sa.Column("ical_sequence", sa.Integer(), nullable=False, server_default="0"),
    )
    # Re-importing the same file must not duplicate its events; rows created in
    # the product carry no UID and are left out of the constraint entirely.
    op.create_index(
        _UID_INDEX,
        _EVENTS,
        ["calendar_id", "ical_uid"],
        unique=True,
        postgresql_where=sa.text("ical_uid IS NOT NULL"),
    )

    op.create_table(
        _TOKENS,
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Uuid(),
            sa.ForeignKey("login_organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "calendar_id",
            sa.Uuid(),
            sa.ForeignKey("calendar_calendars.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("login_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("token_encrypted", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(f"ix_{_TOKENS}_organization_id", _TOKENS, ["organization_id"])
    op.create_index(f"ix_{_TOKENS}_calendar_id", _TOKENS, ["calendar_id"])
    op.create_index(f"ix_{_TOKENS}_user_id", _TOKENS, ["user_id"])
    # The lookup a polled feed performs, and the guarantee that one raw token
    # can never name two subscriptions.
    op.create_index(f"ix_{_TOKENS}_token_hash", _TOKENS, ["token_hash"], unique=True)
    # One subscription per person per calendar: regenerating replaces the row's
    # secret rather than leaving the previous URL alive beside it.
    op.create_index(_TOKEN_OWNER_INDEX, _TOKENS, ["calendar_id", "user_id"], unique=True)

    op.add_column(
        _DELIVERIES,
        sa.Column(
            "composer",
            sa.String(length=20),
            nullable=False,
            server_default="notification",
        ),
    )
    op.add_column(_DELIVERIES, sa.Column("coalesce_key", sa.String(length=200), nullable=True))
    # A burst of edits about the same meeting collapses onto the message still
    # waiting to go out.
    op.create_index(
        _COALESCE_INDEX,
        _DELIVERIES,
        ["coalesce_key"],
        unique=True,
        postgresql_where=sa.text("coalesce_key IS NOT NULL AND status = 'pending'"),
    )


def downgrade() -> None:
    op.drop_index(_COALESCE_INDEX, table_name=_DELIVERIES)
    op.drop_column(_DELIVERIES, "coalesce_key")
    op.drop_column(_DELIVERIES, "composer")

    op.drop_index(_TOKEN_OWNER_INDEX, table_name=_TOKENS)
    op.drop_index(f"ix_{_TOKENS}_token_hash", table_name=_TOKENS)
    op.drop_index(f"ix_{_TOKENS}_user_id", table_name=_TOKENS)
    op.drop_index(f"ix_{_TOKENS}_calendar_id", table_name=_TOKENS)
    op.drop_index(f"ix_{_TOKENS}_organization_id", table_name=_TOKENS)
    op.drop_table(_TOKENS)

    op.drop_index(_UID_INDEX, table_name=_EVENTS)
    op.drop_column(_EVENTS, "ical_sequence")
    op.drop_column(_EVENTS, "ical_uid")
