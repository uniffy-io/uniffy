"""Add chat_message_revisions holding pre-edit message contents.

Revision ID: 094
Revises: 093
Create Date: 2026-08-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "094"
down_revision: str | None = "093"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "chat_message_revisions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("message_id", sa.Uuid(), nullable=False),
        sa.Column("revision_no", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("edited_by", sa.Uuid(), nullable=False),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["message_id"], ["chat_messages.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_chat_message_revisions_message",
        "chat_message_revisions",
        ["message_id", "revision_no"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_chat_message_revisions_message", table_name="chat_message_revisions")
    op.drop_table("chat_message_revisions")
