"""Per-subscriber read-only feed tokens for calendars.

Revision ID: 101
Revises: 100
Create Date: 2026-09-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "101"
down_revision: str | None = "100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "calendar_feed_tokens"
_OWNER_INDEX = "uq_calendar_feed_tokens_calendar_user"


def upgrade() -> None:
    op.create_table(
        _TABLE,
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
    op.create_index(f"ix_{_TABLE}_organization_id", _TABLE, ["organization_id"])
    op.create_index(f"ix_{_TABLE}_calendar_id", _TABLE, ["calendar_id"])
    op.create_index(f"ix_{_TABLE}_user_id", _TABLE, ["user_id"])
    # The lookup a polled feed performs, and the guarantee that one raw token
    # can never name two subscriptions.
    op.create_index(f"ix_{_TABLE}_token_hash", _TABLE, ["token_hash"], unique=True)
    # One subscription per person per calendar: regenerating replaces the row's
    # secret rather than leaving the previous URL alive beside it.
    op.create_index(_OWNER_INDEX, _TABLE, ["calendar_id", "user_id"], unique=True)


def downgrade() -> None:
    op.drop_index(_OWNER_INDEX, table_name=_TABLE)
    op.drop_index(f"ix_{_TABLE}_token_hash", table_name=_TABLE)
    op.drop_index(f"ix_{_TABLE}_user_id", table_name=_TABLE)
    op.drop_index(f"ix_{_TABLE}_calendar_id", table_name=_TABLE)
    op.drop_index(f"ix_{_TABLE}_organization_id", table_name=_TABLE)
    op.drop_table(_TABLE)
