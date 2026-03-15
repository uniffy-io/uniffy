"""Create settings_profiles and bookmarks tables.

Revision ID: 005
Revises: 004
Create Date: 2026-01-20

This migration creates:
1. settings_profiles table for user-specific settings
2. bookmarks table for user-scoped content bookmarks

"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "005"
down_revision: str | None = "004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create settings_profiles and bookmarks tables."""
    # ─────────────────────────────────────────────────────────────────────────
    # Settings Profiles
    # ─────────────────────────────────────────────────────────────────────────
    op.create_table(
        "settings_profiles",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(length=100), nullable=False),
        sa.Column("appearance", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("keyboard_shortcuts", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("notifications", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_settings_profiles_user_name"),
    )

    op.create_index("ix_settings_profiles_user_id", "settings_profiles", ["user_id"], unique=False)
    op.create_index(
        "ix_settings_profiles_is_default", "settings_profiles", ["is_default"], unique=False
    )

    # Migrate existing user preferences to default profiles
    connection = op.get_bind()
    connection.execute(
        sa.text("""
            INSERT INTO settings_profiles
                (id, user_id, name, appearance, is_default, created_at, updated_at)
            SELECT
                gen_random_uuid(),
                id,
                'Default',
                jsonb_strip_nulls(jsonb_build_object(
                    'accent_color', accent_color,
                    'font_family', font_family
                )),
                true,
                NOW(),
                NOW()
            FROM login_users
            WHERE accent_color IS NOT NULL OR font_family IS NOT NULL
        """)
    )

    # Create default profile for users who don't have preferences set
    connection.execute(
        sa.text("""
            INSERT INTO settings_profiles
                (id, user_id, name, appearance, is_default, created_at, updated_at)
            SELECT
                gen_random_uuid(),
                id,
                'Default',
                '{}'::jsonb,
                true,
                NOW(),
                NOW()
            FROM login_users
            WHERE id NOT IN (SELECT user_id FROM settings_profiles)
        """)
    )

    # ─────────────────────────────────────────────────────────────────────────
    # Bookmarks
    # ─────────────────────────────────────────────────────────────────────────
    op.create_table(
        "bookmarks",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("urn", sa.String(length=500), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "urn", name="uq_bookmarks_user_urn"),
    )

    op.create_index("ix_bookmarks_user_id", "bookmarks", ["user_id"], unique=False)
    op.create_index("ix_bookmarks_organization_id", "bookmarks", ["organization_id"], unique=False)
    op.create_index("ix_bookmarks_urn", "bookmarks", ["urn"], unique=False)


def downgrade() -> None:
    """Drop settings_profiles and bookmarks tables."""
    # Drop bookmarks
    op.drop_index("ix_bookmarks_urn", table_name="bookmarks")
    op.drop_index("ix_bookmarks_organization_id", table_name="bookmarks")
    op.drop_index("ix_bookmarks_user_id", table_name="bookmarks")
    op.drop_table("bookmarks")

    # Drop settings_profiles
    op.drop_index("ix_settings_profiles_is_default", table_name="settings_profiles")
    op.drop_index("ix_settings_profiles_user_id", table_name="settings_profiles")
    op.drop_table("settings_profiles")
