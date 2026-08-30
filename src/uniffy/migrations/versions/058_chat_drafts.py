"""Chat drafts: per-user unsent composer text synced across devices.

Revision ID: 058
Revises: 057
Create Date: 2026-07-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "058"
down_revision: str | None = "057"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "chat_drafts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("login_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "organization_id",
            sa.Uuid(),
            sa.ForeignKey("login_organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "channel_id",
            sa.Uuid(),
            sa.ForeignKey("chat_channels.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "root_message_id",
            sa.Uuid(),
            sa.ForeignKey("chat_messages.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_chat_drafts_user_org",
        "chat_drafts",
        ["user_id", "organization_id"],
    )
    op.create_index(
        "uq_chat_drafts_channel",
        "chat_drafts",
        ["user_id", "channel_id"],
        unique=True,
        postgresql_where=sa.text("root_message_id IS NULL"),
    )
    op.create_index(
        "uq_chat_drafts_thread",
        "chat_drafts",
        ["user_id", "channel_id", "root_message_id"],
        unique=True,
        postgresql_where=sa.text("root_message_id IS NOT NULL"),
    )
    # Draft rows are rewritten on every debounced autosave (content +
    # updated_at, both unindexed) and deleted on send. FILLFACTOR=70
    # keeps page slack for HOT updates; tight autovac contains the
    # dead-tuple churn on what stays a small table.
    op.execute(
        sa.text(
            "ALTER TABLE chat_drafts SET ("
            "fillfactor = 70, "
            "autovacuum_vacuum_scale_factor = 0.01, "
            "autovacuum_analyze_scale_factor = 0.02"
            ")"
        )
    )


def downgrade() -> None:
    op.drop_index("uq_chat_drafts_thread", table_name="chat_drafts")
    op.drop_index("uq_chat_drafts_channel", table_name="chat_drafts")
    op.drop_index("ix_chat_drafts_user_org", table_name="chat_drafts")
    op.drop_table("chat_drafts")
