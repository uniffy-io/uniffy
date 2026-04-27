"""Create projects domain tables.

Revision ID: 009
Revises: 008
Create Date: 2026-02-14

Consolidates (original dates):
  - projects, tasks, field_definitions, views, activities (2026-02-14)
  - project slug + task_counter, task number + task_type (2026-02-19)
  - sprints + sprint_id on tasks (2026-02-19)
  - slug partial unique for soft-delete (2026-02-20)
  - time tracking + task_watchers (2026-03-16)
  - type_field_schemas on projects (2026-04-05)
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "009"
down_revision: str | None = "008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_access_mode_enum = postgresql.ENUM(
    "OWNER_ONLY", "EXPLICIT_MEMBERS", "OPEN_TO_ORG", name="accessmode", create_type=False
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
    """Create projects domain tables."""
    op.create_table(
        "projects_projects",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column(
            "access_mode",
            _access_mode_enum,
            nullable=False,
            server_default="OPEN_TO_ORG",
        ),
        sa.Column(
            "baseline_role",
            _content_role_enum,
            nullable=True,
            server_default="EDITOR",
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("icon", sa.String(50), nullable=False, server_default="folder"),
        sa.Column("color", sa.String(20), nullable=False, server_default="#3b82f6"),
        sa.Column("slug", sa.String(20), nullable=False),
        sa.Column("task_counter", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("default_view_id", sa.String(100), nullable=True),
        sa.Column("type_field_schemas", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["owner_id"], ["login_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_projects_projects_organization_id", "projects_projects", ["organization_id"]
    )
    op.create_index("ix_projects_projects_owner_id", "projects_projects", ["owner_id"])
    op.create_index("ix_projects_projects_access_mode", "projects_projects", ["access_mode"])
    op.execute(
        """
        CREATE UNIQUE INDEX uq_projects_slug_per_org
        ON projects_projects (organization_id, slug)
        WHERE is_deleted = false
        """
    )

    op.create_table(
        "projects_sprints",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
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
    op.create_index(
        "ix_projects_sprints_organization_id", "projects_sprints", ["organization_id"]
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_one_active_sprint_per_project "
        "ON projects_sprints (project_id) WHERE status = 'active'"
    )

    op.create_table(
        "projects_field_definitions",
        sa.Column("id", sa.String(100), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("type", sa.String(50), nullable=False),
        sa.Column("is_required", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("config", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects_projects.id"]),
        sa.PrimaryKeyConstraint("id", "project_id"),
    )
    op.create_index(
        "ix_projects_field_definitions_project_id",
        "projects_field_definitions",
        ["project_id"],
    )

    op.create_table(
        "projects_tasks",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(100), nullable=False, server_default="status_todo"),
        sa.Column("priority", sa.String(100), nullable=False, server_default="priority_medium"),
        sa.Column("assignee_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("start_date", sa.String(20), nullable=True),
        sa.Column("due_date", sa.String(20), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column(
            "blocked_by_task_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column("is_milestone", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("recurrence_rule", sa.String(500), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("number", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("task_type", sa.String(50), nullable=False, server_default="task"),
        sa.Column("sprint_id", sa.Uuid(), nullable=True),
        sa.Column("estimated_minutes", sa.Integer(), nullable=True),
        sa.Column("time_spent_minutes", sa.Integer(), nullable=True),
        sa.Column("field_values", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "outgoing_references", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["owner_id"], ["login_users.id"]),
        sa.ForeignKeyConstraint(["parent_id"], ["projects_tasks.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["projects_projects.id"]),
        sa.ForeignKeyConstraint(
            ["sprint_id"],
            ["projects_sprints.id"],
            name="fk_projects_tasks_sprint_id",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "number", name="uq_tasks_number_per_project"),
    )
    op.create_index(
        "ix_projects_tasks_organization_id", "projects_tasks", ["organization_id"]
    )
    op.create_index("ix_projects_tasks_owner_id", "projects_tasks", ["owner_id"])
    op.create_index("ix_projects_tasks_parent_id", "projects_tasks", ["parent_id"])
    op.create_index("ix_projects_tasks_project_id", "projects_tasks", ["project_id"])
    op.create_index("ix_projects_tasks_status", "projects_tasks", ["status"])
    op.create_index("ix_projects_tasks_sprint_id", "projects_tasks", ["sprint_id"])

    op.create_table(
        "projects_task_watchers",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["login_organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["task_id"], ["projects_tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "task_id", name="uq_task_watchers_user_task"),
    )
    op.create_index(
        "ix_projects_task_watchers_user_id", "projects_task_watchers", ["user_id"]
    )
    op.create_index(
        "ix_projects_task_watchers_task_id", "projects_task_watchers", ["task_id"]
    )
    op.create_index(
        "ix_projects_task_watchers_organization_id",
        "projects_task_watchers",
        ["organization_id"],
    )

    op.create_table(
        "projects_views",
        sa.Column("id", sa.String(100), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("type", sa.String(50), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("config", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects_projects.id"]),
        sa.PrimaryKeyConstraint("id", "project_id"),
    )
    op.create_index("ix_projects_views_project_id", "projects_views", ["project_id"])

    op.create_table(
        "projects_activities",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        sa.Column("action", sa.String(50), nullable=False),
        sa.Column("field_id", sa.String(100), nullable=True),
        sa.Column("previous_value", sa.Text(), nullable=True),
        sa.Column("new_value", sa.Text(), nullable=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["actor_id"], ["login_users.id"]),
        sa.ForeignKeyConstraint(["task_id"], ["projects_tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_projects_activities_task_id", "projects_activities", ["task_id"])


def downgrade() -> None:
    """Drop projects domain tables."""
    op.drop_table("projects_activities")
    op.drop_table("projects_views")
    op.drop_table("projects_task_watchers")
    op.drop_table("projects_tasks")
    op.drop_table("projects_field_definitions")
    op.execute("DROP INDEX IF EXISTS uq_one_active_sprint_per_project")
    op.drop_table("projects_sprints")
    op.execute("DROP INDEX IF EXISTS uq_projects_slug_per_org")
    op.drop_table("projects_projects")
