"""Add suspend + soft-delete fields to ``login_organizations``.

Revision ID: 045
Revises: 044
Create Date: 2026-05-25

Platform operators need a way to suspend an org (block sign-in
without losing data) and a way to soft-delete one (mark for purge
with a grace window). Both columns are nullable / default-false so
existing rows pick up the new fields without backfill.

The 30-day purge sweep + the 24h-pre-purge warning run from ARQ
crons. ``purge_warning_sent_at`` is set when the warning fires so
the cron stays idempotent.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "045"
down_revision: str | Sequence[str] | None = "044"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add suspend + soft-delete columns to ``login_organizations``."""
    op.add_column(
        "login_organizations",
        sa.Column("is_suspended", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "login_organizations",
        sa.Column("suspended_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "login_organizations",
        sa.Column("suspended_by_user_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "login_organizations",
        sa.Column("suspension_reason", sa.String(length=1000), nullable=True),
    )
    op.add_column(
        "login_organizations",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "login_organizations",
        sa.Column("deleted_by_user_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "login_organizations",
        sa.Column("deletion_reason", sa.String(length=1000), nullable=True),
    )
    op.add_column(
        "login_organizations",
        sa.Column("purge_warning_sent_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_index(
        "ix_login_organizations_is_suspended",
        "login_organizations",
        ["is_suspended"],
    )
    op.create_index(
        "ix_login_organizations_deleted_at",
        "login_organizations",
        ["deleted_at"],
    )


def downgrade() -> None:
    """Drop suspend + soft-delete columns."""
    op.drop_index("ix_login_organizations_deleted_at", table_name="login_organizations")
    op.drop_index("ix_login_organizations_is_suspended", table_name="login_organizations")
    op.drop_column("login_organizations", "purge_warning_sent_at")
    op.drop_column("login_organizations", "deletion_reason")
    op.drop_column("login_organizations", "deleted_by_user_id")
    op.drop_column("login_organizations", "deleted_at")
    op.drop_column("login_organizations", "suspension_reason")
    op.drop_column("login_organizations", "suspended_by_user_id")
    op.drop_column("login_organizations", "suspended_at")
    op.drop_column("login_organizations", "is_suspended")
