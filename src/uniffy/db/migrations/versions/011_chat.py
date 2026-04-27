"""Create chat domain tables.

Revision ID: 011
Revises: 010
Create Date: 2026-03-22

Consolidates (original dates):
  - chat_channels, messages, threads, members, reactions, resources (2026-03-22)
  - perf indexes + FILLFACTOR + composite reactions PK (2026-03-23)
  - reply_to_id on messages (2026-04-15)
  - muted_until on channel members (2026-04-16)
  - AGENT subjecttype enum value (2026-04-17)
  - channel_members polymorphic subject PK (2026-04-17)
  - thread_participants + thread_follows polymorphic PK (2026-04-17)
  - messages.sender_id soft FK + agent partial index (2026-04-17)
  - mentioned_agent_ids + mentioned_urns + partial GIN indexes (2026-04-17)
  - channel_members.user_id nullable (2026-04-18)

Final state:
  - channels (+ stats counter table, FILLFACTOR 70, autovac tight)
  - messages with reply_to_id, mentions (GIN arrays), agent partial index,
    FILLFACTOR 90, autovac tight, soft-polymorphic sender
  - threads + thread stats (FILLFACTOR 70) + thread participants + thread
    follows, all keyed on (root_message_id, subject_type, subject_id)
  - channel members keyed on (channel_id, subject_type, subject_id), with
    a nullable ``user_id`` mirror column for SUBJECT_TYPE_USER reads,
    muted_until for timed mutes, desktop/mobile push toggles
  - read cursors (channel + thread), reactions (composite PK), channel
    resources (URN mention counters)
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "011"
down_revision: str | None = "010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_channel_type_enum = postgresql.ENUM(
    "PUBLIC", "PRIVATE", "DIRECT", "GROUP_DM", name="channeltype", create_type=False
)
_channel_role_enum = postgresql.ENUM(
    "OWNER", "ADMIN", "MEMBER", name="channelrole", create_type=False
)
_sender_type_enum = postgresql.ENUM(
    "USER", "AGENT", "SYSTEM", "GUEST", name="sendertype", create_type=False
)
_notification_level_enum = postgresql.ENUM(
    "ALL", "MENTIONS", "NONE", name="chatnotificationlevel", create_type=False
)
_subject_type_enum = postgresql.ENUM(
    "USER", "GROUP", "ORGANIZATION", "AGENT", name="subjecttype", create_type=False
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

_now = sa.text("now()")
_false = sa.text("false")
_tz = sa.DateTime(timezone=True)


def upgrade() -> None:
    """Create all chat domain tables."""
    op.create_table(
        "chat_channel_categories",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", _tz, nullable=False, server_default=_now),
        sa.Column("updated_at", _tz, nullable=False, server_default=_now),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["login_users.id"]),
        sa.UniqueConstraint(
            "organization_id", "name", name="uq_chat_categories_org_name"
        ),
    )
    op.create_index(
        "ix_chat_channel_categories_org",
        "chat_channel_categories",
        ["organization_id"],
    )

    op.create_table(
        "chat_channels",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
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
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["owner_id"], ["login_users.id"]),
        sa.ForeignKeyConstraint(
            ["category_id"], ["chat_channel_categories.id"], ondelete="SET NULL"
        ),
        sa.UniqueConstraint("organization_id", "slug", name="uq_chat_channels_org_slug"),
    )
    op.create_index("ix_chat_channels_owner", "chat_channels", ["owner_id"])
    op.create_index("ix_chat_channels_category", "chat_channels", ["category_id"])
    op.create_index(
        "ix_chat_channels_org_active",
        "chat_channels",
        ["organization_id", "channel_type"],
        postgresql_where=sa.text("is_deleted = false"),
    )

    op.create_table(
        "chat_channel_stats",
        sa.Column("channel_id", sa.Uuid(), nullable=False),
        sa.Column("message_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("root_message_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_message_at", _tz, nullable=True),
        sa.Column("last_root_message_at", _tz, nullable=True),
        sa.Column("member_count", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("channel_id"),
        sa.ForeignKeyConstraint(["channel_id"], ["chat_channels.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_chat_channel_stats_last_root",
        "chat_channel_stats",
        [sa.text("last_root_message_at DESC NULLS LAST")],
    )

    op.create_table(
        "chat_messages",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("channel_id", sa.Uuid(), nullable=False),
        sa.Column("sender_id", sa.Uuid(), nullable=False),
        sa.Column(
            "sender_type", _sender_type_enum, nullable=False, server_default="USER"
        ),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("root_id", sa.Uuid(), nullable=True),
        sa.Column("reply_to_id", sa.Uuid(), nullable=True),
        sa.Column("edited_at", _tz, nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=_false),
        sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default=_false),
        sa.Column("metadata", postgresql.JSONB(), nullable=True),
        sa.Column(
            "mentioned_agent_ids", postgresql.ARRAY(sa.Uuid()), nullable=True
        ),
        sa.Column("mentioned_urns", postgresql.ARRAY(sa.Text()), nullable=True),
        sa.Column("created_at", _tz, nullable=False, server_default=_now),
        sa.Column("updated_at", _tz, nullable=False, server_default=_now),
        sa.Column("deleted_at", _tz, nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["channel_id"], ["chat_channels.id"], ondelete="CASCADE"),
    )
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
    op.create_index("ix_chat_messages_reply_to_id", "chat_messages", ["reply_to_id"])
    op.create_index(
        "ix_chat_messages_channel_agent",
        "chat_messages",
        ["channel_id", "sender_id", sa.text("created_at DESC")],
        postgresql_where=sa.text("sender_type = 'AGENT' AND is_deleted = false"),
    )
    op.create_index(
        "ix_chat_messages_mentioned_agents",
        "chat_messages",
        ["mentioned_agent_ids"],
        postgresql_using="gin",
        postgresql_where=sa.text("mentioned_agent_ids IS NOT NULL"),
    )
    op.create_index(
        "ix_chat_messages_mentioned_urns",
        "chat_messages",
        ["mentioned_urns"],
        postgresql_using="gin",
        postgresql_where=sa.text("mentioned_urns IS NOT NULL"),
    )
    op.execute(
        sa.text(
            "COMMENT ON COLUMN chat_messages.sender_id IS "
            "'Soft polymorphic reference. When sender_type=USER refs "
            "login_users.id; when sender_type=AGENT refs agents_agents.id. "
            "No FK so the column can hold user or agent UUIDs.'"
        )
    )

    op.create_table(
        "chat_threads",
        sa.Column("root_message_id", sa.Uuid(), nullable=False),
        sa.Column("channel_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", _tz, nullable=False, server_default=_now),
        sa.PrimaryKeyConstraint("root_message_id"),
        sa.ForeignKeyConstraint(
            ["root_message_id"], ["chat_messages.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["channel_id"], ["chat_channels.id"], ondelete="CASCADE"),
    )

    op.create_table(
        "chat_thread_stats",
        sa.Column("root_message_id", sa.Uuid(), nullable=False),
        sa.Column("reply_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_reply_at", _tz, nullable=True),
        sa.PrimaryKeyConstraint("root_message_id"),
        sa.ForeignKeyConstraint(
            ["root_message_id"], ["chat_threads.root_message_id"], ondelete="CASCADE"
        ),
    )

    op.create_table(
        "chat_thread_participants",
        sa.Column("root_message_id", sa.Uuid(), nullable=False),
        sa.Column("subject_type", _subject_type_enum, nullable=False),
        sa.Column("subject_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", _tz, nullable=False, server_default=_now),
        sa.PrimaryKeyConstraint("root_message_id", "subject_type", "subject_id"),
        sa.ForeignKeyConstraint(
            ["root_message_id"], ["chat_threads.root_message_id"], ondelete="CASCADE"
        ),
    )

    op.create_table(
        "chat_thread_follows",
        sa.Column("root_message_id", sa.Uuid(), nullable=False),
        sa.Column("subject_type", _subject_type_enum, nullable=False),
        sa.Column("subject_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", _tz, nullable=False, server_default=_now),
        sa.PrimaryKeyConstraint("root_message_id", "subject_type", "subject_id"),
        sa.ForeignKeyConstraint(
            ["root_message_id"], ["chat_threads.root_message_id"], ondelete="CASCADE"
        ),
    )
    op.create_index(
        "ix_chat_thread_follows_subject",
        "chat_thread_follows",
        ["subject_type", "subject_id"],
    )

    op.create_table(
        "chat_channel_members",
        sa.Column("channel_id", sa.Uuid(), nullable=False),
        sa.Column("subject_type", _subject_type_enum, nullable=False),
        sa.Column("subject_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column(
            "role", _channel_role_enum, nullable=False, server_default="MEMBER"
        ),
        sa.Column(
            "notification_level",
            _notification_level_enum,
            nullable=False,
            server_default="ALL",
        ),
        sa.Column("is_muted", sa.Boolean(), nullable=False, server_default=_false),
        sa.Column("muted_until", _tz, nullable=True),
        sa.Column("joined_at", _tz, nullable=False, server_default=_now),
        sa.Column("desktop_enabled", sa.Boolean(), nullable=True),
        sa.Column("mobile_enabled", sa.Boolean(), nullable=True),
        sa.Column(
            "badge_all_messages", sa.Boolean(), nullable=False, server_default=_false
        ),
        sa.Column(
            "follow_all_threads", sa.Boolean(), nullable=False, server_default=_false
        ),
        sa.PrimaryKeyConstraint("channel_id", "subject_type", "subject_id"),
        sa.ForeignKeyConstraint(
            ["channel_id"], ["chat_channels.id"], ondelete="CASCADE"
        ),
    )
    op.execute(
        sa.text(
            "CREATE INDEX ix_chat_members_subject_covering "
            "ON chat_channel_members (subject_type, subject_id) "
            "INCLUDE (channel_id, role)"
        )
    )

    op.create_table(
        "chat_read_cursors",
        sa.Column("channel_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("last_read_message_id", sa.Uuid(), nullable=True),
        sa.Column("last_read_at", _tz, nullable=True),
        sa.PrimaryKeyConstraint("channel_id", "user_id"),
        sa.ForeignKeyConstraint(
            ["channel_id"], ["chat_channels.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_chat_read_cursors_user", "chat_read_cursors", ["user_id"])

    op.create_table(
        "chat_thread_read_cursors",
        sa.Column("root_message_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("last_read_at", _tz, nullable=True),
        sa.Column("unread_mentions", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("root_message_id", "user_id"),
        sa.ForeignKeyConstraint(
            ["root_message_id"], ["chat_threads.root_message_id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"], ondelete="CASCADE"),
    )

    op.create_table(
        "chat_reactions",
        sa.Column("message_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("emoji", sa.String(64), nullable=False),
        sa.Column("created_at", _tz, nullable=False, server_default=_now),
        sa.PrimaryKeyConstraint("message_id", "user_id", "emoji"),
        sa.ForeignKeyConstraint(
            ["message_id"], ["chat_messages.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"]),
    )
    op.create_index("ix_chat_reactions_message", "chat_reactions", ["message_id", "emoji"])

    op.create_table(
        "chat_channel_resources",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("channel_id", sa.Uuid(), nullable=False),
        sa.Column("urn", sa.String(500), nullable=False),
        sa.Column("content_type", _content_type_enum, nullable=False),
        sa.Column("first_mentioned_at", _tz, nullable=False, server_default=_now),
        sa.Column("last_mentioned_at", _tz, nullable=False, server_default=_now),
        sa.Column("mention_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("first_mentioned_by", sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["channel_id"], ["chat_channels.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["first_mentioned_by"], ["login_users.id"]),
        sa.UniqueConstraint("channel_id", "urn", name="uq_chat_resources_channel_urn"),
    )
    op.create_index(
        "ix_chat_resources_channel_type",
        "chat_channel_resources",
        ["channel_id", "content_type", sa.text("last_mentioned_at DESC")],
    )

    _autovac = "autovacuum_vacuum_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.02"
    op.execute(sa.text(f"ALTER TABLE chat_channel_stats SET (fillfactor = 70, {_autovac})"))
    op.execute(sa.text(f"ALTER TABLE chat_thread_stats SET (fillfactor = 70, {_autovac})"))
    op.execute(sa.text(f"ALTER TABLE chat_messages SET (fillfactor = 90, {_autovac})"))


def downgrade() -> None:
    """Drop all chat domain tables."""
    op.drop_table("chat_channel_resources")
    op.drop_table("chat_reactions")
    op.drop_table("chat_thread_read_cursors")
    op.drop_table("chat_read_cursors")
    op.drop_table("chat_channel_members")
    op.drop_table("chat_thread_follows")
    op.drop_table("chat_thread_participants")
    op.drop_table("chat_thread_stats")
    op.drop_table("chat_threads")
    op.drop_table("chat_messages")
    op.drop_table("chat_channel_stats")
    op.drop_table("chat_channels")
    op.drop_table("chat_channel_categories")
