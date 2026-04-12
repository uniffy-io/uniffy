"""Add chat domain tables.

Revision ID: 037
Revises: 036
Create Date: 2026-03-22

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "037"
down_revision: str = "036"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Shorthand for common column patterns
_now = sa.text("now()")
_false = sa.text("false")
_tz = sa.DateTime(timezone=True)

_channel_type_enum = postgresql.ENUM(
    "PUBLIC",
    "PRIVATE",
    "DIRECT",
    "GROUP_DM",
    name="channeltype",
    create_type=False,
)

_channel_role_enum = postgresql.ENUM(
    "OWNER",
    "ADMIN",
    "MEMBER",
    name="channelrole",
    create_type=False,
)

_sender_type_enum = postgresql.ENUM(
    "USER",
    "AGENT",
    "SYSTEM",
    "GUEST",
    name="sendertype",
    create_type=False,
)

_notification_level_enum = postgresql.ENUM(
    "ALL",
    "MENTIONS",
    "NONE",
    name="chatnotificationlevel",
    create_type=False,
)

_content_type_enum = postgresql.ENUM(
    "NOTE",
    "FILE",
    "FOLDER",
    "CALENDAR_EVENT",
    "CHAT_MESSAGE",
    "USER",
    "PROJECT",
    "TASK",
    "AGENT",
    "PROVIDER_KEY",
    "PROMPT",
    "AGENT_CRON_TASK",
    "CHAT",
    "ROOM",
    name="contenttype",
    create_type=False,
)


def upgrade() -> None:
    """Create all chat domain tables."""
    postgresql.ENUM(
        "PUBLIC",
        "PRIVATE",
        "DIRECT",
        "GROUP_DM",
        name="channeltype",
    ).create(op.get_bind(), checkfirst=True)
    postgresql.ENUM(
        "OWNER",
        "ADMIN",
        "MEMBER",
        name="channelrole",
    ).create(op.get_bind(), checkfirst=True)
    postgresql.ENUM(
        "USER",
        "AGENT",
        "SYSTEM",
        "GUEST",
        name="sendertype",
    ).create(op.get_bind(), checkfirst=True)
    postgresql.ENUM(
        "ALL",
        "MENTIONS",
        "NONE",
        name="chatnotificationlevel",
    ).create(op.get_bind(), checkfirst=True)

    op.create_table(
        "chat_channel_categories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", _tz, nullable=False, server_default=_now),
        sa.Column("updated_at", _tz, nullable=False, server_default=_now),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["login_organizations.id"],
        ),
        sa.ForeignKeyConstraint(["created_by"], ["login_users.id"]),
        sa.UniqueConstraint(
            "organization_id",
            "name",
            name="uq_chat_categories_org_name",
        ),
    )
    op.create_index(
        "ix_chat_channel_categories_org",
        "chat_channel_categories",
        ["organization_id"],
    )

    op.create_table(
        "chat_channels",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("slug", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("channel_type", _channel_type_enum, nullable=False),
        sa.Column("is_encrypted", sa.Boolean(), nullable=False, server_default=_false),
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=_false),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=_false),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=_false),
        sa.Column("icon", sa.String(100), nullable=False, server_default=""),
        sa.Column("category_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", _tz, nullable=False, server_default=_now),
        sa.Column("updated_at", _tz, nullable=False, server_default=_now),
        sa.Column("deleted_at", _tz, nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["login_organizations.id"],
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["login_users.id"]),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["chat_channel_categories.id"],
            ondelete="SET NULL",
        ),
        sa.UniqueConstraint(
            "organization_id",
            "slug",
            name="uq_chat_channels_org_slug",
        ),
    )
    op.create_index("ix_chat_channels_org", "chat_channels", ["organization_id"])
    op.create_index("ix_chat_channels_owner", "chat_channels", ["owner_id"])
    op.create_index("ix_chat_channels_type", "chat_channels", ["channel_type"])
    op.create_index("ix_chat_channels_category", "chat_channels", ["category_id"])

    op.create_table(
        "chat_channel_stats",
        sa.Column("channel_id", sa.Uuid(), nullable=False),
        sa.Column("message_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("root_message_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_message_at", _tz, nullable=True),
        sa.Column("last_root_message_at", _tz, nullable=True),
        sa.Column("member_count", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("channel_id"),
        sa.ForeignKeyConstraint(
            ["channel_id"],
            ["chat_channels.id"],
            ondelete="CASCADE",
        ),
    )

    op.create_table(
        "chat_messages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("channel_id", sa.Uuid(), nullable=False),
        sa.Column("sender_id", sa.Uuid(), nullable=False),
        sa.Column(
            "sender_type",
            _sender_type_enum,
            nullable=False,
            server_default="USER",
        ),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("root_id", sa.Uuid(), nullable=True),
        sa.Column("edited_at", _tz, nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=_false),
        sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default=_false),
        sa.Column("metadata", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", _tz, nullable=False, server_default=_now),
        sa.Column("updated_at", _tz, nullable=False, server_default=_now),
        sa.Column("deleted_at", _tz, nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["channel_id"],
            ["chat_channels.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["sender_id"], ["login_users.id"]),
    )
    op.create_index("ix_chat_messages_sender", "chat_messages", ["sender_id"])
    op.create_index("ix_chat_messages_root", "chat_messages", ["root_id"])
    op.create_index(
        "ix_chat_messages_channel_timeline",
        "chat_messages",
        ["channel_id", "created_at", "id"],
    )
    op.create_index(
        "ix_chat_messages_channel_roots",
        "chat_messages",
        ["channel_id", "created_at", "id"],
        postgresql_where=sa.text("root_id IS NULL AND is_deleted = false"),
    )
    op.create_index(
        "ix_chat_messages_thread_replies",
        "chat_messages",
        ["root_id", "created_at", "id"],
        postgresql_where=sa.text("root_id IS NOT NULL"),
    )
    op.create_index(
        "ix_chat_messages_pinned",
        "chat_messages",
        ["channel_id"],
        postgresql_where=sa.text("is_pinned = true AND is_deleted = false"),
    )

    op.create_table(
        "chat_threads",
        sa.Column("root_message_id", sa.Uuid(), nullable=False),
        sa.Column("channel_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", _tz, nullable=False, server_default=_now),
        sa.PrimaryKeyConstraint("root_message_id"),
        sa.ForeignKeyConstraint(
            ["root_message_id"],
            ["chat_messages.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["channel_id"],
            ["chat_channels.id"],
            ondelete="CASCADE",
        ),
    )

    op.create_table(
        "chat_thread_stats",
        sa.Column("root_message_id", sa.Uuid(), nullable=False),
        sa.Column("reply_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_reply_at", _tz, nullable=True),
        sa.PrimaryKeyConstraint("root_message_id"),
        sa.ForeignKeyConstraint(
            ["root_message_id"],
            ["chat_threads.root_message_id"],
            ondelete="CASCADE",
        ),
    )

    op.create_table(
        "chat_thread_participants",
        sa.Column("root_message_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", _tz, nullable=False, server_default=_now),
        sa.PrimaryKeyConstraint("root_message_id", "user_id"),
        sa.ForeignKeyConstraint(
            ["root_message_id"],
            ["chat_threads.root_message_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["login_users.id"],
            ondelete="CASCADE",
        ),
    )

    op.create_table(
        "chat_channel_members",
        sa.Column("channel_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "role",
            _channel_role_enum,
            nullable=False,
            server_default="MEMBER",
        ),
        sa.Column(
            "notification_level",
            _notification_level_enum,
            nullable=False,
            server_default="ALL",
        ),
        sa.Column("is_muted", sa.Boolean(), nullable=False, server_default=_false),
        sa.Column("joined_at", _tz, nullable=False, server_default=_now),
        sa.Column("desktop_enabled", sa.Boolean(), nullable=True),
        sa.Column("mobile_enabled", sa.Boolean(), nullable=True),
        sa.Column(
            "badge_all_messages",
            sa.Boolean(),
            nullable=False,
            server_default=_false,
        ),
        sa.Column(
            "follow_all_threads",
            sa.Boolean(),
            nullable=False,
            server_default=_false,
        ),
        sa.PrimaryKeyConstraint("channel_id", "user_id"),
        sa.ForeignKeyConstraint(
            ["channel_id"],
            ["chat_channels.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["login_users.id"],
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_chat_members_user",
        "chat_channel_members",
        ["user_id"],
    )

    op.create_table(
        "chat_read_cursors",
        sa.Column("channel_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("last_read_message_id", sa.Uuid(), nullable=True),
        sa.Column("last_read_at", _tz, nullable=True),
        sa.PrimaryKeyConstraint("channel_id", "user_id"),
        sa.ForeignKeyConstraint(
            ["channel_id"],
            ["chat_channels.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["login_users.id"],
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_chat_read_cursors_user",
        "chat_read_cursors",
        ["user_id"],
    )

    op.create_table(
        "chat_thread_follows",
        sa.Column("root_message_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", _tz, nullable=False, server_default=_now),
        sa.PrimaryKeyConstraint("root_message_id", "user_id"),
        sa.ForeignKeyConstraint(
            ["root_message_id"],
            ["chat_threads.root_message_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["login_users.id"],
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_chat_thread_follows_user",
        "chat_thread_follows",
        ["user_id"],
    )

    op.create_table(
        "chat_thread_read_cursors",
        sa.Column("root_message_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("last_read_at", _tz, nullable=True),
        sa.Column("unread_mentions", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("root_message_id", "user_id"),
        sa.ForeignKeyConstraint(
            ["root_message_id"],
            ["chat_threads.root_message_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["login_users.id"],
            ondelete="CASCADE",
        ),
    )

    op.create_table(
        "chat_reactions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("message_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("emoji", sa.String(64), nullable=False),
        sa.Column("created_at", _tz, nullable=False, server_default=_now),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["message_id"],
            ["chat_messages.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"]),
        sa.UniqueConstraint(
            "message_id",
            "user_id",
            "emoji",
            name="uq_chat_reactions_unique",
        ),
    )
    op.create_index(
        "ix_chat_reactions_message",
        "chat_reactions",
        ["message_id", "emoji"],
    )

    op.create_table(
        "chat_channel_resources",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("channel_id", sa.Uuid(), nullable=False),
        sa.Column("urn", sa.String(500), nullable=False),
        sa.Column("content_type", _content_type_enum, nullable=False),
        sa.Column(
            "first_mentioned_at",
            _tz,
            nullable=False,
            server_default=_now,
        ),
        sa.Column(
            "last_mentioned_at",
            _tz,
            nullable=False,
            server_default=_now,
        ),
        sa.Column("mention_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("first_mentioned_by", sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["channel_id"],
            ["chat_channels.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["first_mentioned_by"],
            ["login_users.id"],
        ),
        sa.UniqueConstraint(
            "channel_id",
            "urn",
            name="uq_chat_resources_channel_urn",
        ),
    )
    op.create_index(
        "ix_chat_resources_channel_type",
        "chat_channel_resources",
        ["channel_id", "content_type", sa.text("last_mentioned_at DESC")],
    )

    # Autovacuum tuning on high-write tables
    _autovac = "autovacuum_vacuum_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.02"
    op.execute(sa.text(f"ALTER TABLE chat_channel_stats SET ({_autovac})"))
    op.execute(sa.text(f"ALTER TABLE chat_thread_stats SET ({_autovac})"))
    op.execute(sa.text(f"ALTER TABLE chat_messages SET ({_autovac})"))


def downgrade() -> None:
    """Drop all chat domain tables."""
    op.drop_table("chat_channel_resources")
    op.drop_table("chat_reactions")
    op.drop_table("chat_thread_read_cursors")
    op.drop_table("chat_thread_follows")
    op.drop_table("chat_read_cursors")
    op.drop_table("chat_channel_members")
    op.drop_table("chat_thread_participants")
    op.drop_table("chat_thread_stats")
    op.drop_table("chat_threads")
    op.drop_table("chat_messages")
    op.drop_table("chat_channel_stats")
    op.drop_table("chat_channels")
    op.drop_table("chat_channel_categories")

    op.execute(sa.text("DROP TYPE IF EXISTS channeltype"))
    op.execute(sa.text("DROP TYPE IF EXISTS channelrole"))
    op.execute(sa.text("DROP TYPE IF EXISTS sendertype"))
    op.execute(sa.text("DROP TYPE IF EXISTS chatnotificationlevel"))
