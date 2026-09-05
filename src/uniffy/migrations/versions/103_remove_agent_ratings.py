"""Drop dedicated agent reply ratings; downgrade restores only their empty schema."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "103"
down_revision = "102"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("agents_message_feedback")


def downgrade() -> None:
    op.create_table(
        "agents_message_feedback",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "agents_message_id",
            UUID(as_uuid=True),
            sa.ForeignKey("agents_messages.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "chat_message_id",
            UUID(as_uuid=True),
            sa.ForeignKey("chat_messages.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("login_users.id"),
            nullable=False,
        ),
        sa.Column("rating", sa.String(8), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(agents_message_id IS NULL) != (chat_message_id IS NULL)",
            name="ck_agents_message_feedback_one_target",
        ),
    )
    op.create_index(
        "uq_agents_message_feedback_session",
        "agents_message_feedback",
        ["agents_message_id", "user_id"],
        unique=True,
        postgresql_where=sa.text("agents_message_id IS NOT NULL"),
    )
    op.create_index(
        "uq_agents_message_feedback_chat",
        "agents_message_feedback",
        ["chat_message_id", "user_id"],
        unique=True,
        postgresql_where=sa.text("chat_message_id IS NOT NULL"),
    )
