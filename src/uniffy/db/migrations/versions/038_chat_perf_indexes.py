"""Chat domain performance indexes, FILLFACTOR, and reaction PK.

Revision ID: 038
Revises: 037
Create Date: 2026-03-23

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "038"
down_revision: str = "037"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add performance indexes and restructure chat_reactions PK."""

    # 1. Composite partial index on channels for sidebar/browse queries
    #    Replaces single-column ix_chat_channels_org for filtered lookups
    op.drop_index("ix_chat_channels_org", table_name="chat_channels")
    op.drop_index("ix_chat_channels_type", table_name="chat_channels")
    op.create_index(
        "ix_chat_channels_org_active",
        "chat_channels",
        ["organization_id", "channel_type"],
        postgresql_where=sa.text("is_deleted = false"),
    )

    # 2. Covering index on members for sidebar query (user -> channels)
    #    The PK is (channel_id, user_id) which is wrong direction for
    #    "list all channels for user_id". This index covers the JOIN.
    op.drop_index("ix_chat_members_user", table_name="chat_channel_members")
    op.create_index(
        "ix_chat_members_user_covering",
        "chat_channel_members",
        ["user_id"],
        postgresql_include=["channel_id", "role"],
    )

    # 3. Index on channel_stats for sidebar sort order
    op.create_index(
        "ix_chat_channel_stats_last_root",
        "chat_channel_stats",
        [sa.text("last_root_message_at DESC NULLS LAST")],
    )

    # 4. FILLFACTOR for HOT updates on high-write tables
    op.execute(sa.text(
        "ALTER TABLE chat_channel_stats SET (fillfactor = 70)"
    ))
    op.execute(sa.text(
        "ALTER TABLE chat_thread_stats SET (fillfactor = 70)"
    ))
    op.execute(sa.text(
        "ALTER TABLE chat_messages SET (fillfactor = 90)"
    ))

    # 5. Fix ix_chat_resources_channel_type to have explicit DESC
    #    The migration 037 used sa.text("last_mentioned_at DESC") but
    #    the model Index didn't match. Drop and recreate consistently.
    op.drop_index(
        "ix_chat_resources_channel_type",
        table_name="chat_channel_resources",
    )
    op.create_index(
        "ix_chat_resources_channel_type",
        "chat_channel_resources",
        ["channel_id", "content_type", sa.text("last_mentioned_at DESC")],
    )

    # 6. Restructure chat_reactions: drop surrogate id PK,
    #    use composite PK (message_id, user_id, emoji)
    # Drop the unique constraint (it becomes the PK)
    op.drop_constraint("uq_chat_reactions_unique", "chat_reactions")
    # Drop the existing index on (message_id, emoji)
    op.drop_index("ix_chat_reactions_message", table_name="chat_reactions")
    # Drop old PK on id column
    op.drop_constraint("chat_reactions_pkey", "chat_reactions", type_="primary")
    # Drop the id column
    op.drop_column("chat_reactions", "id")
    # Create new composite PK
    op.create_primary_key(
        "chat_reactions_pkey",
        "chat_reactions",
        ["message_id", "user_id", "emoji"],
    )
    # Recreate the (message_id, emoji) index for grouped lookups
    op.create_index(
        "ix_chat_reactions_message",
        "chat_reactions",
        ["message_id", "emoji"],
    )


def downgrade() -> None:
    """Reverse performance changes."""
    # Restore reaction id column and old PK
    op.drop_index("ix_chat_reactions_message", table_name="chat_reactions")
    op.drop_constraint("chat_reactions_pkey", "chat_reactions", type_="primary")
    op.add_column(
        "chat_reactions",
        sa.Column("id", sa.Uuid(), nullable=True),
    )
    op.execute(sa.text("UPDATE chat_reactions SET id = gen_random_uuid()"))
    op.alter_column("chat_reactions", "id", nullable=False)
    op.create_primary_key("chat_reactions_pkey", "chat_reactions", ["id"])
    op.create_unique_constraint(
        "uq_chat_reactions_unique",
        "chat_reactions",
        ["message_id", "user_id", "emoji"],
    )
    op.create_index(
        "ix_chat_reactions_message",
        "chat_reactions",
        ["message_id", "emoji"],
    )

    # Restore resource index (without DESC)
    op.drop_index(
        "ix_chat_resources_channel_type",
        table_name="chat_channel_resources",
    )
    op.create_index(
        "ix_chat_resources_channel_type",
        "chat_channel_resources",
        ["channel_id", "content_type", sa.text("last_mentioned_at DESC")],
    )

    # Remove FILLFACTOR (reset to default 100)
    op.execute(sa.text(
        "ALTER TABLE chat_messages SET (fillfactor = 100)"
    ))
    op.execute(sa.text(
        "ALTER TABLE chat_thread_stats SET (fillfactor = 100)"
    ))
    op.execute(sa.text(
        "ALTER TABLE chat_channel_stats SET (fillfactor = 100)"
    ))

    # Restore stats index
    op.drop_index(
        "ix_chat_channel_stats_last_root",
        table_name="chat_channel_stats",
    )

    # Restore original member index
    op.drop_index(
        "ix_chat_members_user_covering",
        table_name="chat_channel_members",
    )
    op.create_index(
        "ix_chat_members_user",
        "chat_channel_members",
        ["user_id"],
    )

    # Restore original channel indexes
    op.drop_index("ix_chat_channels_org_active", table_name="chat_channels")
    op.create_index("ix_chat_channels_org", "chat_channels", ["organization_id"])
    op.create_index("ix_chat_channels_type", "chat_channels", ["channel_type"])
