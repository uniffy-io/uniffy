"""Create bookmarks, notifications, push subscriptions, settings profiles, application settings.

Revision ID: 008
Revises: 007
Create Date: 2026-01-20

Consolidates (original dates):
  - settings_profiles + bookmarks (2026-01-20)
  - notifications + push_subscriptions (2026-02-08)
  - push settings collapsed into browser (2026-02-09)
  - application_settings (2026-02-09)
  - custom_status on settings_profiles (2026-03-10)
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "008"
down_revision: str | None = "007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create bookmarks, notifications, push, settings, app settings tables."""
    op.create_table(
        "bookmarks",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("urn", sa.String(500), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "urn", name="uq_bookmarks_user_urn"),
    )
    op.create_index("ix_bookmarks_user_id", "bookmarks", ["user_id"])
    op.create_index("ix_bookmarks_organization_id", "bookmarks", ["organization_id"])
    op.create_index("ix_bookmarks_urn", "bookmarks", ["urn"])

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
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notification_metadata", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"]),
        sa.ForeignKeyConstraint(["actor_id"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_notifications_organization_id", "notifications", ["organization_id"])
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"])
    op.create_index("ix_notifications_source_urn", "notifications", ["source_urn"])
    op.create_index(
        "ix_notifications_user_org_unread",
        "notifications",
        ["user_id", "organization_id", "is_read", "created_at"],
    )
    op.create_index("ix_notifications_user_unread_count", "notifications", ["user_id", "is_read"])

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
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "endpoint", name="uq_push_subscriptions_user_endpoint"),
    )
    op.create_index("ix_push_subscriptions_user_id", "push_subscriptions", ["user_id"])

    op.create_table(
        "settings_profiles",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("appearance", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("keyboard_shortcuts", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("notifications", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("custom_status", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_settings_profiles_user_name"),
    )
    op.create_index("ix_settings_profiles_user_id", "settings_profiles", ["user_id"])
    op.create_index("ix_settings_profiles_is_default", "settings_profiles", ["is_default"])

    op.create_table(
        "application_settings",
        sa.Column("key", sa.String(255), primary_key=True),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("is_encrypted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("description", sa.String(500), nullable=False, server_default=""),
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
    )


def downgrade() -> None:
    """Drop the tables created here."""
    op.drop_table("application_settings")
    op.drop_table("settings_profiles")
    op.drop_table("push_subscriptions")
    op.drop_table("notifications")
    op.drop_table("bookmarks")
