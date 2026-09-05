"""Create exact-version skill invocation lifecycle records."""

import sqlalchemy as sa
from alembic import op

revision = "101"
down_revision = "100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agents_skill_invocations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("agent_id", sa.Uuid(), nullable=False),
        sa.Column("skill_id", sa.Uuid(), nullable=False),
        sa.Column("skill_version_id", sa.Uuid(), nullable=False),
        sa.Column("skill_version_number", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("surface", sa.String(16), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=True),
        sa.Column("channel_id", sa.Uuid(), nullable=True),
        sa.Column("trigger_message_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("error_code", sa.String(32), nullable=True),
        sa.Column("tool_error_count", sa.Integer(), nullable=False),
        sa.Column("run_log_id", sa.Uuid(), nullable=True),
        sa.Column("response_message_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('started', 'completed', 'failed', 'rejected', 'cancelled')",
            name="ck_agents_skill_invocations_status",
        ),
        sa.CheckConstraint("source = 'user'", name="ck_agents_skill_invocations_source"),
        sa.CheckConstraint(
            "(surface = 'session' AND session_id IS NOT NULL AND channel_id IS NULL) OR "
            "(surface = 'chat' AND channel_id IS NOT NULL AND session_id IS NULL)",
            name="ck_agents_skill_invocations_destination",
        ),
        sa.CheckConstraint(
            "(status = 'started' AND completed_at IS NULL) OR "
            "(status <> 'started' AND completed_at IS NOT NULL)",
            name="ck_agents_skill_invocations_terminal",
        ),
        sa.CheckConstraint(
            "skill_version_number > 0 AND tool_error_count >= 0",
            name="ck_agents_skill_invocations_counts",
        ),
    )
    op.create_index(
        "ix_agents_skill_invocations_org_created",
        "agents_skill_invocations",
        ["organization_id", "created_at"],
    )
    op.create_index(
        "ix_agents_skill_invocations_skill_version_created",
        "agents_skill_invocations",
        ["skill_id", "skill_version_number", "created_at"],
    )
    op.create_index(
        "ix_agents_skill_invocations_agent_created",
        "agents_skill_invocations",
        ["agent_id", "created_at"],
    )
    op.create_index(
        "ix_agents_skill_invocations_response",
        "agents_skill_invocations",
        ["organization_id", "surface", "response_message_id"],
        postgresql_where=sa.text("response_message_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_table("agents_skill_invocations")
