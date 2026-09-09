"""Persist isolated skill evaluation cases and immutable requested runs."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "105"
down_revision = "104"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agents_skill_evaluation_cases",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "organization_id", sa.Uuid(), sa.ForeignKey("login_organizations.id"), nullable=False
        ),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("login_users.id"), nullable=False),
        sa.Column("skill_id", sa.Uuid()),
        sa.Column("draft_id", sa.Uuid()),
        sa.Column("fields", postgresql.JSONB(), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(skill_id IS NULL) <> (draft_id IS NULL)", name="ck_skill_evaluation_case_scope"
        ),
    )
    for scope in ("skill", "draft"):
        op.create_index(
            f"ix_skill_evaluation_cases_{scope}",
            "agents_skill_evaluation_cases",
            ["organization_id", f"{scope}_id"],
        )
    op.create_table(
        "agents_skill_evaluation_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "organization_id", sa.Uuid(), sa.ForeignKey("login_organizations.id"), nullable=False
        ),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("login_users.id"), nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("request_digest", sa.String(64), nullable=False),
        sa.Column("case_id", sa.Uuid(), nullable=False),
        sa.Column("agent_id", sa.Uuid(), nullable=False),
        sa.Column("skill_id", sa.Uuid()),
        sa.Column("skill_version_id", sa.Uuid()),
        sa.Column("version_number", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("draft_id", sa.Uuid()),
        sa.Column("target_digest", sa.String(64), nullable=False),
        sa.Column("snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="queued"),
        sa.Column("error", sa.String(32)),
        sa.Column("output", sa.Text(), nullable=False, server_default=""),
        sa.Column("observations", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("judge_result", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("model", sa.String(255), nullable=False, server_default=""),
        sa.Column("run_log_id", sa.Uuid()),
        sa.Column("cost", sa.Numeric(12, 6)),
        sa.Column("cost_currency", sa.String(3)),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("duration_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("deadline_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(skill_version_id IS NULL) <> (draft_id IS NULL)", name="ck_skill_evaluation_run_target"
        ),
        sa.CheckConstraint(
            "skill_version_id IS NULL OR (skill_id IS NOT NULL AND version_number > 0)",
            name="ck_skill_evaluation_run_version",
        ),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'passed', 'failed', 'inconclusive', 'error')",
            name="ck_skill_evaluation_run_status",
        ),
        sa.UniqueConstraint(
            "organization_id", "request_id", "case_id", name="uq_skill_evaluation_request_case"
        ),
    )
    for scope in ("skill", "draft"):
        op.create_index(
            f"ix_skill_evaluation_runs_{scope}",
            "agents_skill_evaluation_runs",
            ["organization_id", "agent_id", f"{scope}_id", "id"],
        )
    op.create_index(
        "ix_skill_evaluation_runs_deadline",
        "agents_skill_evaluation_runs",
        ["deadline_at"],
        postgresql_where=sa.text("status IN ('queued', 'running')"),
    )
    op.create_index(
        "ix_skill_evaluation_runs_open_org",
        "agents_skill_evaluation_runs",
        ["organization_id"],
        postgresql_where=sa.text("status IN ('queued', 'running')"),
    )


def downgrade() -> None:
    op.drop_table("agents_skill_evaluation_runs")
    op.drop_table("agents_skill_evaluation_cases")
