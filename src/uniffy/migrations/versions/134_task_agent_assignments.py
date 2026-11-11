"""Agent assignees on tasks and projects, and agent authorship on comments."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "134"
down_revision: str | None = "133"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agents_task_assignments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "organization_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("login_organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "task_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects_tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "agent_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("agents_agents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "assigned_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("login_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("reason", sa.String(24), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("agents_sessions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("change_request", sa.Text(), nullable=True),
        sa.Column("last_error", sa.String(200), nullable=True),
        sa.Column("dispatches", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("available_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "uq_agents_task_assignments_current",
        "agents_task_assignments",
        ["task_id"],
        unique=True,
        postgresql_where=sa.text("is_current"),
    )
    op.create_index(
        "ix_agents_task_assignments_due",
        "agents_task_assignments",
        ["available_at"],
        postgresql_where=sa.text("status IN ('pending', 'running')"),
    )
    op.create_index(
        "ix_agents_task_assignments_task",
        "agents_task_assignments",
        ["task_id", "created_at"],
    )
    op.create_index(
        "ix_agents_task_assignments_agent_current",
        "agents_task_assignments",
        ["agent_id", "is_current"],
    )

    op.add_column(
        "projects_projects",
        sa.Column(
            "agent_assignee_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("agents_agents.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "projects_projects",
        sa.Column(
            "agent_assignee_set_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("login_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "projects_projects",
        sa.Column("agent_assignee_set_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_projects_projects_agent_assignee",
        "projects_projects",
        ["agent_assignee_id"],
        postgresql_where=sa.text("agent_assignee_id IS NOT NULL"),
    )

    op.add_column(
        "comments_comments",
        sa.Column(
            "agent_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("agents_agents.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "comments_comments",
        sa.Column(
            "agent_session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("agents_sessions.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("comments_comments", "agent_session_id")
    op.drop_column("comments_comments", "agent_id")
    op.drop_index("ix_projects_projects_agent_assignee", "projects_projects")
    op.drop_column("projects_projects", "agent_assignee_set_at")
    op.drop_column("projects_projects", "agent_assignee_set_by")
    op.drop_column("projects_projects", "agent_assignee_id")
    op.drop_index("ix_agents_task_assignments_agent_current", "agents_task_assignments")
    op.drop_index("ix_agents_task_assignments_task", "agents_task_assignments")
    op.drop_index("ix_agents_task_assignments_due", "agents_task_assignments")
    op.drop_index("uq_agents_task_assignments_current", "agents_task_assignments")
    op.drop_table("agents_task_assignments")
