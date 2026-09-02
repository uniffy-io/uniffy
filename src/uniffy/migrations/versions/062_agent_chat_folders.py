"""Per-user agent-chat folders + member-row folder assignment.

Revision ID: 062
Revises: 061
Create Date: 2026-07-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "062"
down_revision: str | None = "061"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "chat_agent_folders",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            UUID(as_uuid=True),
            sa.ForeignKey("login_organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("login_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("organization_id", "user_id", "name", name="uq_agent_folders_user_name"),
    )
    op.create_index(
        "ix_chat_agent_folders_user",
        "chat_agent_folders",
        ["organization_id", "user_id"],
    )
    op.add_column(
        "chat_channel_members",
        sa.Column(
            "agent_folder_id",
            UUID(as_uuid=True),
            sa.ForeignKey("chat_agent_folders.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("chat_channel_members", "agent_folder_id")
    op.drop_index("ix_chat_agent_folders_user", table_name="chat_agent_folders")
    op.drop_table("chat_agent_folders")
