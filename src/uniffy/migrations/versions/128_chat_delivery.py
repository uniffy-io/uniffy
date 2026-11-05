"""Persist chat delivery work and agent invocation admission."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "128"
down_revision = "127"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chat_deliveries",
        sa.Column(
            "message_id",
            postgresql.UUID(),
            sa.ForeignKey("chat_messages.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("effect", sa.String(24), primary_key=True),
        sa.Column(
            "organization_id",
            postgresql.UUID(),
            sa.ForeignKey("login_organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("last_error", sa.String(100)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("available_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_chat_deliveries_due",
        "chat_deliveries",
        ["available_at"],
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_index(
        "ix_chat_deliveries_org_status",
        "chat_deliveries",
        ["organization_id", "status", "created_at"],
    )
    op.create_table(
        "agents_chat_triggers",
        sa.Column("id", postgresql.UUID(), primary_key=True),
        sa.Column(
            "organization_id",
            postgresql.UUID(),
            sa.ForeignKey("login_organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "message_id",
            postgresql.UUID(),
            sa.ForeignKey("chat_messages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "agent_id",
            postgresql.UUID(),
            sa.ForeignKey("agents_agents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("run_id", postgresql.UUID(), nullable=False),
        sa.Column("rule", sa.String(24), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("last_error", sa.String(100)),
        sa.Column("dispatches", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("available_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("message_id", "agent_id", name="uq_agents_chat_trigger"),
    )
    op.create_index(
        "ix_agents_chat_triggers_due",
        "agents_chat_triggers",
        ["available_at"],
        postgresql_where=sa.text("status IN ('pending', 'running')"),
    )
    op.create_index(
        "ix_agents_chat_triggers_org_status", "agents_chat_triggers", ["organization_id", "status"]
    )


def downgrade() -> None:
    op.drop_table("agents_chat_triggers")
    op.drop_table("chat_deliveries")
