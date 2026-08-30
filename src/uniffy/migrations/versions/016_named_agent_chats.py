"""Add named agent chat columns to chat_channels with backfill.

Revision ID: 016
Revises: 015
Create Date: 2026-05-06

Introduces the named-agent-chat feature:

- ``is_agent_dm``: denormalized boolean. True when the DIRECT channel has an
  AGENT subject as a member. Powers a partial index for cheap "list my agent
  chats" queries and lets the sidebar partition channels client-side without
  joining ``chat_channel_members``.
- ``custom_name``: optional override the user can set per agent chat (e.g.
  "Onboarding plan" instead of the auto-generated agent name). NULL means
  "use the auto-generated ``name`` column".
- ``agent_id``: denormalized FK to ``agents_agents`` for agent DMs. NULL for
  every other channel kind. Lets the sidebar / agent profile show "all my
  chats with agent X" without a member-table join.

Backfill: every existing DIRECT channel that has at least one AGENT-subject
member is marked ``is_agent_dm=true`` and gets that agent's id copied into
``agent_id``. Existing user-user DMs and group DMs are left untouched.

Pre-flight assertion: no DIRECT channel has more than one AGENT subject. The
1:1 user-agent invariant has held in practice; if a fixture ever violated
it, ``agent_id`` would be ambiguous and this migration must fail loudly.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "016"
down_revision: str | None = "015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "chat_channels",
        sa.Column(
            "is_agent_dm",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "chat_channels",
        sa.Column("custom_name", sa.String(length=200), nullable=True),
    )
    op.add_column(
        "chat_channels",
        sa.Column(
            "agent_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("agents_agents.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    bind = op.get_bind()

    duplicate_check = bind.execute(
        sa.text(
            """
            SELECT m.channel_id, COUNT(*) AS agent_count
            FROM chat_channel_members m
            JOIN chat_channels c ON c.id = m.channel_id
            WHERE m.subject_type = 'AGENT'
              AND c.channel_type = 'DIRECT'
              AND c.is_deleted = false
            GROUP BY m.channel_id
            HAVING COUNT(*) > 1
            """
        )
    ).fetchall()
    if duplicate_check:
        raise RuntimeError(
            "Migration 016 aborted: found DIRECT channels with multiple AGENT "
            f"subjects. Resolve manually before retrying. Channels: {duplicate_check!r}"
        )

    bind.execute(
        sa.text(
            """
            UPDATE chat_channels c
            SET is_agent_dm = true,
                agent_id = m.subject_id
            FROM chat_channel_members m
            WHERE m.channel_id = c.id
              AND m.subject_type = 'AGENT'
              AND c.channel_type = 'DIRECT'
              AND c.is_deleted = false
            """
        )
    )

    op.create_index(
        "ix_chat_channels_user_agent_dm",
        "chat_channels",
        ["organization_id", "agent_id"],
        unique=False,
        postgresql_where=sa.text("is_agent_dm = true AND is_deleted = false"),
    )

    op.alter_column("chat_channels", "is_agent_dm", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_chat_channels_user_agent_dm", table_name="chat_channels")
    op.drop_column("chat_channels", "agent_id")
    op.drop_column("chat_channels", "custom_name")
    op.drop_column("chat_channels", "is_agent_dm")
