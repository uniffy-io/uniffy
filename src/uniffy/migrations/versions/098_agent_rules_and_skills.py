"""Add per-agent rules, explicit skill invocations, draft generation and evaluations."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "098"
down_revision = "097"
branch_labels = None
depends_on = None

_TABLES = ("agents_skills", "agents_skill_versions", "agents_skill_drafts")


def upgrade() -> None:
    op.create_table(
        "agents_rules",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "organization_id", sa.Uuid(), sa.ForeignKey("login_organizations.id"), nullable=True
        ),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("latest_version_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("active_version_id", sa.Uuid(), nullable=True),
        sa.Column("active_version_pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(source = 'bundled' AND organization_id IS NULL) OR "
            "(source = 'organization' AND organization_id IS NOT NULL)",
            name="ck_agents_rules_source_scope",
        ),
        sa.CheckConstraint("status IN ('active', 'retired')", name="ck_agents_rules_status"),
    )
    op.create_index("ix_agents_rules_organization_id", "agents_rules", ["organization_id"])
    op.create_index("ix_agents_rules_active_version_id", "agents_rules", ["active_version_id"])
    op.create_index(
        "uq_agents_rules_org_name",
        "agents_rules",
        ["organization_id", "name"],
        unique=True,
        postgresql_where=sa.text("organization_id IS NOT NULL"),
    )
    op.create_index(
        "uq_agents_rules_bundled_name",
        "agents_rules",
        ["name"],
        unique=True,
        postgresql_where=sa.text("organization_id IS NULL"),
    )
    op.create_table(
        "agents_rule_versions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "rule_id",
            sa.Uuid(),
            sa.ForeignKey("agents_rules.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("author_id", sa.Uuid(), nullable=True),
        sa.Column("change_summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("parent_version_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("rule_id", "version_number", name="uq_agents_rule_versions_number"),
    )
    op.add_column(
        "agents_agents",
        sa.Column(
            "enabled_rules",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )

    op.execute("DELETE FROM org_settings WHERE namespace = 'agents' AND key = 'enabled_rules'")

    for table in _TABLES:
        op.alter_column(table, "requires_context", new_column_name="supported_surfaces")
        op.create_check_constraint(
            f"ck_{table}_supported_surfaces",
            table,
            "jsonb_typeof(supported_surfaces) = 'array' "
            """AND supported_surfaces <@ '["session", "chat"]'::jsonb""",
        )
        op.drop_column(table, "when_to_use")
    op.drop_column("agents_skills", "always_active")
    op.drop_column("agents_skill_drafts", "suggested_always_active")

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

    op.drop_table("agents_skill_usages")
    op.execute(
        sa.text(
            "DELETE FROM org_settings WHERE namespace = 'agents' AND key = 'skill_evolution_enabled'"
        )
    )

    op.drop_table("agents_message_feedback")

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

    op.create_table(
        "agents_message_feedback",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "agents_message_id",
            sa.Uuid(),
            sa.ForeignKey("agents_messages.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "chat_message_id",
            sa.Uuid(),
            sa.ForeignKey("chat_messages.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "user_id",
            sa.Uuid(),
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

    op.create_table(
        "agents_skill_usages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_log_id", sa.Uuid(), nullable=True),
        sa.Column("session_id", sa.Uuid(), nullable=True),
        sa.Column("skill_id", sa.Uuid(), nullable=False),
        sa.Column("skill_version", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("agent_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("injected", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("viewed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("invoked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_agents_skill_usages_skill_created",
        "agents_skill_usages",
        ["skill_id", "created_at"],
    )
    op.create_index(
        "ix_agents_skill_usages_session",
        "agents_skill_usages",
        ["session_id"],
    )

    op.drop_table("agents_skill_invocations")

    for table in _TABLES:
        op.drop_constraint(f"ck_{table}_supported_surfaces", table, type_="check")
        op.alter_column(table, "supported_surfaces", new_column_name="requires_context")
        op.add_column(table, sa.Column("when_to_use", sa.Text(), nullable=False, server_default=""))
    # Removed activation and routing values cannot be reconstructed.
    op.add_column(
        "agents_skills",
        sa.Column("always_active", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "agents_skill_drafts",
        sa.Column(
            "suggested_always_active", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )

    op.drop_column("agents_agents", "enabled_rules")
    op.drop_table("agents_rule_versions")
    op.drop_table("agents_rules")
