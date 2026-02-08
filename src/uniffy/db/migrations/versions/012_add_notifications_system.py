"""Add notifications system.

This migration:
1. Creates notifications table for storing user notifications
2. Creates push_subscriptions table for Web Push subscription storage

Revision ID: 012
Revises: 011
Create Date: 2026-02-08

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "012"
down_revision: str | None = "011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add notifications and push_subscriptions tables."""
    # Create notifications table
    op.create_table(
        "notifications",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("notification_type", sa.String(50), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("body", sa.Text(), nullable=False, server_default=""),
        sa.Column("source_urn", sa.String(500), nullable=True),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notification_metadata", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"]),
        sa.ForeignKeyConstraint(["actor_id"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    # Individual column indexes
    op.create_index(
        "ix_notifications_organization_id",
        "notifications",
        ["organization_id"],
    )
    op.create_index(
        "ix_notifications_user_id",
        "notifications",
        ["user_id"],
    )
    op.create_index(
        "ix_notifications_source_urn",
        "notifications",
        ["source_urn"],
    )
    # Composite indexes for common queries
    op.create_index(
        "ix_notifications_user_org_unread",
        "notifications",
        ["user_id", "organization_id", "is_read", "created_at"],
    )
    op.create_index(
        "ix_notifications_user_unread_count",
        "notifications",
        ["user_id", "is_read"],
    )

    # Create push_subscriptions table
    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("endpoint", sa.String(2000), nullable=False),
        sa.Column("p256dh_key", sa.String(500), nullable=False),
        sa.Column("auth_key", sa.String(500), nullable=False),
        sa.Column("user_agent", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "endpoint", name="uq_push_subscriptions_user_endpoint"),
    )
    op.create_index(
        "ix_push_subscriptions_user_id",
        "push_subscriptions",
        ["user_id"],
    )


def downgrade() -> None:
    """Remove notifications and push_subscriptions tables."""
    op.drop_index("ix_push_subscriptions_user_id", table_name="push_subscriptions")
    op.drop_table("push_subscriptions")

    op.drop_index("ix_notifications_user_unread_count", table_name="notifications")
    op.drop_index("ix_notifications_user_org_unread", table_name="notifications")
    op.drop_index("ix_notifications_source_urn", table_name="notifications")
    op.drop_index("ix_notifications_user_id", table_name="notifications")
    op.drop_index("ix_notifications_organization_id", table_name="notifications")
    op.drop_table("notifications")
