"""Add reply_to_id column for inline quote replies.

Revision ID: 042
Revises: 041
"""

import sqlalchemy as sa
from alembic import op

revision = "042"
down_revision = "041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "chat_messages",
        sa.Column("reply_to_id", sa.Uuid(), nullable=True),
    )
    op.create_index(
        "ix_chat_messages_reply_to_id",
        "chat_messages",
        ["reply_to_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_chat_messages_reply_to_id", table_name="chat_messages")
    op.drop_column("chat_messages", "reply_to_id")
