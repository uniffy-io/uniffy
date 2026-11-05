"""Deduplicate retried chat sends."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "127"
down_revision = "126"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chat_messages", sa.Column("client_message_id", postgresql.UUID(), nullable=True))
    op.add_column("chat_messages", sa.Column("request_fingerprint", sa.String(64), nullable=True))
    op.create_index(
        "uq_chat_messages_client_send",
        "chat_messages",
        ["channel_id", "sender_id", "client_message_id"],
        unique=True,
        postgresql_where=sa.text("client_message_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_chat_messages_client_send", table_name="chat_messages")
    op.drop_column("chat_messages", "request_fingerprint")
    op.drop_column("chat_messages", "client_message_id")
