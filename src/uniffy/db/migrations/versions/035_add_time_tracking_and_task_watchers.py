"""Add time tracking fields and task watchers table.

Revision ID: 035
Revises: 034
"""

import sqlalchemy as sa
from alembic import op

revision = "035"
down_revision = "034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add estimated_minutes, time_spent_minutes to tasks and create task_watchers table."""
    # Add time tracking columns to projects_tasks
    op.add_column(
        "projects_tasks",
        sa.Column("estimated_minutes", sa.Integer(), nullable=True),
    )
    op.add_column(
        "projects_tasks",
        sa.Column("time_spent_minutes", sa.Integer(), nullable=True),
    )

    # Create task watchers table
    op.create_table(
        "projects_task_watchers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["login_users.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["login_organizations.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["task_id"],
            ["projects_tasks.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "task_id", name="uq_task_watchers_user_task"
        ),
    )
    op.create_index(
        "ix_projects_task_watchers_user_id",
        "projects_task_watchers",
        ["user_id"],
    )
    op.create_index(
        "ix_projects_task_watchers_task_id",
        "projects_task_watchers",
        ["task_id"],
    )
    op.create_index(
        "ix_projects_task_watchers_organization_id",
        "projects_task_watchers",
        ["organization_id"],
    )


def downgrade() -> None:
    """Remove time tracking fields and task watchers table."""
    op.drop_table("projects_task_watchers")
    op.drop_column("projects_tasks", "time_spent_minutes")
    op.drop_column("projects_tasks", "estimated_minutes")
