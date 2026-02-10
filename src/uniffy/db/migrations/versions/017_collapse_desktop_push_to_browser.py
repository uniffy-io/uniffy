"""Collapse desktop + push notification channels into single browser channel.

Rewrites JSONB keys in settings_profiles.notifications:
- Top-level: "desktop_enabled" -> "browser_enabled"
- channel_overrides nested dicts: remove "desktop", rename "push" -> "browser"
  (if both existed, OR the values)

Revision ID: 017
Revises: 016
Create Date: 2026-02-10

"""

from collections.abc import Sequence

from alembic import op

revision: str = "017"
down_revision: str | None = "016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Migrate notification settings from desktop+push to browser channel."""
    # 1. Rename top-level key "desktop_enabled" -> "browser_enabled"
    op.execute("""
        UPDATE settings_profiles
        SET notifications = (notifications - 'desktop_enabled')
            || jsonb_build_object('browser_enabled', notifications->'desktop_enabled')
        WHERE notifications ? 'desktop_enabled'
    """)

    # 2. For each notification type in channel_overrides, collapse desktop+push into browser.
    #    Strategy: for every row that has channel_overrides, use a subquery to rebuild the object.
    op.execute("""
        UPDATE settings_profiles
        SET notifications = jsonb_set(
            notifications,
            '{channel_overrides}',
            (
                SELECT coalesce(jsonb_object_agg(
                    notif_type,
                    (
                        -- Start with original channels, remove desktop and push
                        (channels - 'desktop' - 'push')
                        -- Add browser: true if either desktop or push was true
                        || CASE
                            WHEN (channels->>'desktop')::boolean IS TRUE
                                 OR (channels->>'push')::boolean IS TRUE
                            THEN jsonb_build_object('browser', true)
                            WHEN channels ? 'desktop' OR channels ? 'push'
                            THEN jsonb_build_object('browser', coalesce(
                                (channels->>'push')::boolean,
                                (channels->>'desktop')::boolean,
                                false))
                            ELSE '{}'::jsonb
                           END
                    )
                ), '{}'::jsonb)
                FROM jsonb_each(notifications->'channel_overrides') AS kv(notif_type, channels)
            )
        )
        WHERE notifications ? 'channel_overrides'
          AND notifications->'channel_overrides' != '{}'::jsonb
    """)


def downgrade() -> None:
    """Revert browser channel back to desktop + push."""
    # 1. Rename top-level key "browser_enabled" -> "desktop_enabled"
    op.execute("""
        UPDATE settings_profiles
        SET notifications = (notifications - 'browser_enabled')
            || jsonb_build_object('desktop_enabled', notifications->'browser_enabled')
        WHERE notifications ? 'browser_enabled'
    """)

    # 2. In channel_overrides, rename "browser" back to both "desktop" and "push"
    op.execute("""
        UPDATE settings_profiles
        SET notifications = jsonb_set(
            notifications,
            '{channel_overrides}',
            (
                SELECT coalesce(jsonb_object_agg(
                    notif_type,
                    (channels - 'browser')
                    || CASE
                        WHEN channels ? 'browser'
                        THEN jsonb_build_object(
                            'desktop', channels->'browser',
                            'push', channels->'browser'
                        )
                        ELSE '{}'::jsonb
                       END
                ), '{}'::jsonb)
                FROM jsonb_each(notifications->'channel_overrides') AS kv(notif_type, channels)
            )
        )
        WHERE notifications ? 'channel_overrides'
          AND notifications->'channel_overrides' != '{}'::jsonb
    """)
