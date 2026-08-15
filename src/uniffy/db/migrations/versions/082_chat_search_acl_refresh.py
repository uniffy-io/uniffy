"""Queue durable chat-message search ACL refreshes.

Revision ID: 082
Revises: 081
Create Date: 2026-08-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "082"
down_revision: str | None = "081"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "chat_search_acl_refresh_queue",
        sa.Column("channel_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["channel_id"],
            ["chat_channels.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["login_organizations.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("channel_id"),
    )
    op.create_index(
        "ix_chat_search_acl_refresh_created",
        "chat_search_acl_refresh_queue",
        ["created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_chat_search_acl_refresh_created",
        table_name="chat_search_acl_refresh_queue",
    )
    op.drop_table("chat_search_acl_refresh_queue")
