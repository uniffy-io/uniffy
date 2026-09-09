"""Add explicit skill draft generation and exact invocation evidence."""

import sqlalchemy as sa
from alembic import op

revision = "104"
down_revision = "103"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("agents_skill_drafts", "status", type_=sa.String(32))
    for name in ("invocation_id", "target_version_id", "thread_root_id"):
        op.add_column("agents_skill_drafts", sa.Column(name, sa.Uuid(), nullable=True))
    op.add_column("agents_skill_drafts", sa.Column("target_version_number", sa.Integer()))
    op.add_column(
        "agents_skill_drafts",
        sa.Column("generation_attempt", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("agents_skill_drafts", sa.Column("generation_error", sa.String(32)))
    for name in ("generation_started_at", "generation_deadline_at"):
        op.add_column("agents_skill_drafts", sa.Column(name, sa.DateTime(timezone=True)))
    op.create_check_constraint(
        "ck_agents_skill_drafts_attempt", "agents_skill_drafts", "generation_attempt >= 0"
    )
    op.create_index(
        "ix_agents_skill_drafts_generation_deadline",
        "agents_skill_drafts",
        ["generation_deadline_at"],
        postgresql_where=sa.text("status = 'generating' AND NOT is_deleted"),
    )


def downgrade() -> None:
    op.execute(
        "UPDATE agents_skill_drafts SET status = 'discarded', is_deleted = true "
        "WHERE status IN ('generating', 'generation_failed')"
    )
    op.drop_constraint("ck_agents_skill_drafts_attempt", "agents_skill_drafts")
    op.drop_index("ix_agents_skill_drafts_generation_deadline", "agents_skill_drafts")
    op.alter_column("agents_skill_drafts", "status", type_=sa.String(16))
    for name in (
        "invocation_id",
        "target_version_id",
        "target_version_number",
        "thread_root_id",
        "generation_attempt",
        "generation_error",
        "generation_started_at",
        "generation_deadline_at",
    ):
        op.drop_column("agents_skill_drafts", name)
