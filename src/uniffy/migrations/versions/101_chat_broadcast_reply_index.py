"""Index the channel copy linked to a thread reply."""

import sqlalchemy as sa
from alembic import op

revision = "101"
down_revision = "100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_chat_messages_broadcast_reply",
        "chat_messages",
        ["channel_id", sa.text("(metadata -> 'thread_reply' ->> 'reply_message_id')")],
        postgresql_where=sa.text("root_id IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_chat_messages_broadcast_reply", table_name="chat_messages")
