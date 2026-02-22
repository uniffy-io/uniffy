"""Add sprints table and sprint_id to tasks.

Revision ID: 024
Revises: 026
Create Date: 2026-02-19

"""

import sqlalchemy as sa
from alembic import op

revision = "024"
down_revision = "026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add projects_sprints table and sprint_id column on tasks."""
    # 1. Create sprints table
    op.create_table(
        "projects_sprints",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("organization_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("goal", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(20), nullable=False, server_default="planned"),
        sa.Column("start_date", sa.String(20), nullable=True),
        sa.Column("end_date", sa.String(20), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects_projects.id"]),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_projects_sprints_project_id", "projects_sprints", ["project_id"])
    op.create_index("ix_projects_sprints_organization_id", "projects_sprints", ["organization_id"])
    # Partial unique index: only one active sprint per project
    op.execute(
        "CREATE UNIQUE INDEX uq_one_active_sprint_per_project "
        "ON projects_sprints (project_id) WHERE status = 'active'"
    )

    # 2. Add sprint_id to tasks
    op.add_column(
        "projects_tasks",
        sa.Column("sprint_id", sa.UUID(), nullable=True),
    )
    op.create_foreign_key(
        "fk_projects_tasks_sprint_id",
        "projects_tasks",
        "projects_sprints",
        ["sprint_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_projects_tasks_sprint_id", "projects_tasks", ["sprint_id"])


def downgrade() -> None:
    """Remove sprint_id from tasks and drop sprints table."""
    op.drop_index("ix_projects_tasks_sprint_id", "projects_tasks")
    op.drop_constraint("fk_projects_tasks_sprint_id", "projects_tasks", type_="foreignkey")
    op.drop_column("projects_tasks", "sprint_id")
    op.drop_index("ix_projects_sprints_organization_id", "projects_sprints")
    op.drop_index("ix_projects_sprints_project_id", "projects_sprints")
    op.execute("DROP INDEX IF EXISTS uq_one_active_sprint_per_project")
    op.drop_table("projects_sprints")
