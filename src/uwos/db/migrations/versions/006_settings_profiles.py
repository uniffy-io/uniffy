"""Create settings_profiles table and migrate existing user preferences.

Revision ID: 006
Revises: 005
Create Date: 2026-01-17

This migration:
1. Creates the settings_profiles table for user-specific settings
2. Migrates existing User.accent_color and User.font_family to default profiles

"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "006"
down_revision: str | None = "005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create settings_profiles table and migrate existing preferences."""
    # Create settings_profiles table
    op.create_table(
        "settings_profiles",
        sa.Column("id", sa.Uuid(), nullable=False),
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

    # Create indexes
    op.create_index(
        "ix_settings_profiles_user_id", "settings_profiles", ["user_id"], unique=False
    )
    op.create_index(
        "ix_settings_profiles_is_default", "settings_profiles", ["is_default"], unique=False
    )

    # Migrate existing user preferences to default profiles
    # This creates a "Default" profile for each user who has accent_color or font_family set
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


def downgrade() -> None:
    """Drop settings_profiles table."""
    op.drop_index("ix_settings_profiles_is_default", table_name="settings_profiles")
    op.drop_index("ix_settings_profiles_user_id", table_name="settings_profiles")
    op.drop_table("settings_profiles")
