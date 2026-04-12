"""Add agent cron tasks and cron run logs tables.

Revision ID: 028
Revises: 027
Create Date: 2026-03-07

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "028"
down_revision: str = "027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_access_mode_enum = postgresql.ENUM(
    "OWNER_ONLY",
    "EXPLICIT_MEMBERS",
    "OPEN_TO_ORG",
    name="accessmode",
    create_type=False,
)
_content_role_enum = postgresql.ENUM(
    "OWNER",
    "ADMIN",
    "EDITOR",
    "COMMENTER",
    "VIEWER",
    "BLOCKED",
    name="contentrole",
    create_type=False,
)


def upgrade() -> None:
    """Create agents_cron_tasks and agents_cron_run_logs tables."""

    op.create_table(
        "agents_cron_tasks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("agent_id", sa.Uuid(), nullable=False),
        sa.Column("execution_user_id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("cron_expression", sa.String(100), nullable=False),
        sa.Column("timezone", sa.String(100), nullable=False, server_default=sa.text("'UTC'")),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_run_status", sa.String(20), nullable=True),
        sa.Column("last_run_error", sa.Text(), nullable=True),
        sa.Column("run_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("consecutive_failures", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "max_consecutive_failures", sa.Integer(), nullable=False, server_default=sa.text("3")
        ),
        sa.Column(
            "access_mode",
            _access_mode_enum,
            nullable=False,
            server_default="OWNER_ONLY",
        ),
        sa.Column("baseline_role", _content_role_enum, nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["owner_id"], ["login_users.id"]),
        sa.ForeignKeyConstraint(["agent_id"], ["agents_agents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["execution_user_id"], ["login_users.id"]),
        sa.ForeignKeyConstraint(["session_id"], ["agents_sessions.id"], ondelete="SET NULL"),
    )

    op.create_index("ix_agents_cron_tasks_org_id", "agents_cron_tasks", ["organization_id"])
    op.create_index("ix_agents_cron_tasks_owner_id", "agents_cron_tasks", ["owner_id"])
    op.create_index("ix_agents_cron_tasks_agent_id", "agents_cron_tasks", ["agent_id"])
    op.create_index(
        "ix_agents_cron_tasks_execution_user_id", "agents_cron_tasks", ["execution_user_id"]
    )
    op.create_index("ix_agents_cron_tasks_access_mode", "agents_cron_tasks", ["access_mode"])

    op.execute(
        sa.text(
            "CREATE INDEX ix_agents_cron_tasks_due "
            "ON agents_cron_tasks (organization_id, next_run_at) "
            "WHERE is_enabled = true AND is_deleted = false"
        )
    )

    op.create_table(
        "agents_cron_run_logs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("cron_task_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("agent_run_log_id", sa.Uuid(), nullable=True),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("result_summary", sa.Text(), nullable=True),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["cron_task_id"], ["agents_cron_tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["agent_run_log_id"], ["agents_run_logs.id"], ondelete="SET NULL"),
    )

    op.create_index("ix_agents_cron_run_logs_task_id", "agents_cron_run_logs", ["cron_task_id"])
    op.create_index("ix_agents_cron_run_logs_org_id", "agents_cron_run_logs", ["organization_id"])
    op.create_index(
        "ix_agents_cron_run_logs_task_started",
        "agents_cron_run_logs",
        ["cron_task_id", "started_at"],
    )


def downgrade() -> None:
    """Drop agents_cron_run_logs and agents_cron_tasks tables."""
    op.drop_table("agents_cron_run_logs")
    op.drop_index("ix_agents_cron_tasks_due", table_name="agents_cron_tasks")
    op.drop_table("agents_cron_tasks")
