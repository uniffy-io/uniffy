"""Add project slug, task_counter, task number and task_type.

Revision ID: 026
Revises: 023
Create Date: 2026-02-19

"""

import sqlalchemy as sa
from alembic import op

revision = "026"
down_revision = "023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add slug/task_counter to projects and number/task_type to tasks."""
    # 1. Add slug (nullable first for backfill)
    op.add_column(
        "projects_projects",
        sa.Column("slug", sa.String(20), nullable=True),
    )

    # 2. Add task_counter
    op.add_column(
        "projects_projects",
        sa.Column("task_counter", sa.Integer(), nullable=False, server_default="0"),
    )

    # 3. Backfill slugs from project names
    # Generate initials from name words (uppercase, max 5 chars)
    # Use ROW_NUMBER to handle collisions within the same org
    op.execute(
        """
        WITH base AS (
            SELECT
                id,
                UPPER(
                    SUBSTRING(
                        REGEXP_REPLACE(name, '[^a-zA-Z0-9]', '', 'g'),
                        1, 5
                    )
                ) AS base_slug,
                ROW_NUMBER() OVER (
                    PARTITION BY
                        organization_id,
                        UPPER(
                            SUBSTRING(
                                REGEXP_REPLACE(
                                    name, '[^a-zA-Z0-9]', '', 'g'
                                ),
                                1, 5
                            )
                        )
                    ORDER BY created_at, id
                ) AS rn
            FROM projects_projects
        )
        UPDATE projects_projects p
        SET slug = CASE
            WHEN b.rn = 1 THEN b.base_slug
            ELSE b.base_slug || b.rn::text
        END
        FROM base b
        WHERE p.id = b.id
        """
    )

    # Backfill deleted projects with a unique fallback slug
    op.execute(
        """
        UPDATE projects_projects
        SET slug = UPPER(SUBSTRING(MD5(id::text), 1, 5))
        WHERE slug IS NULL
        """
    )

    # 4. Set slug NOT NULL and add unique index
    op.alter_column("projects_projects", "slug", nullable=False)
    op.create_unique_constraint(
        "uq_projects_slug_per_org",
        "projects_projects",
        ["organization_id", "slug"],
    )

    # 5. Backfill task_counter = count of non-deleted tasks per project
    op.execute(
        """
        UPDATE projects_projects p
        SET task_counter = (
            SELECT COUNT(*)
            FROM projects_tasks t
            WHERE t.project_id = p.id
              AND t.is_deleted = FALSE
        )
        """
    )

    # 6. Add number to tasks (nullable first for backfill)
    op.add_column(
        "projects_tasks",
        sa.Column("number", sa.Integer(), nullable=True),
    )

    # 7. Backfill task numbers using ROW_NUMBER ordered by created_at
    op.execute(
        """
        WITH numbered AS (
            SELECT
                id,
                ROW_NUMBER() OVER (
                    PARTITION BY project_id
                    ORDER BY created_at, id
                ) AS rn
            FROM projects_tasks
        )
        UPDATE projects_tasks t
        SET number = n.rn
        FROM numbered n
        WHERE t.id = n.id
        """
    )

    # 8. Set number NOT NULL and add unique index
    op.alter_column("projects_tasks", "number", nullable=False)
    op.create_unique_constraint(
        "uq_tasks_number_per_project",
        "projects_tasks",
        ["project_id", "number"],
    )

    # 9. Add task_type column
    op.add_column(
        "projects_tasks",
        sa.Column(
            "task_type",
            sa.String(50),
            nullable=False,
            server_default="task",
        ),
    )


def downgrade() -> None:
    """Remove slug/task_counter from projects and number/task_type from tasks."""
    op.drop_column("projects_tasks", "task_type")
    op.drop_constraint("uq_tasks_number_per_project", "projects_tasks", type_="unique")
    op.drop_column("projects_tasks", "number")
    op.drop_constraint("uq_projects_slug_per_org", "projects_projects", type_="unique")
    op.drop_column("projects_projects", "task_counter")
    op.drop_column("projects_projects", "slug")
