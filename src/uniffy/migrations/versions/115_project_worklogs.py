"""Add project worklogs and timers; backfill one import worklog per task with time spent.

``projects_tasks.time_spent_minutes`` stays as the rollup of live worklogs. The
backfilled row carries the whole historical total on the task's last update day,
attributed to the task creator, so the rollup is exact from the first write.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "115"
down_revision: str | None = "114"
branch_labels: str | None = None
depends_on: str | None = None

_WORKLOGS = "projects_worklogs"
_TIMERS = "projects_timers"


def upgrade() -> None:
    op.create_table(
        _WORKLOGS,
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Uuid(),
            sa.ForeignKey("login_organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("task_id", sa.Uuid(), sa.ForeignKey("projects_tasks.id"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("login_users.id"), nullable=False),
        sa.Column(
            "created_by_user_id", sa.Uuid(), sa.ForeignKey("login_users.id"), nullable=False
        ),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    # The week view reads one person over a bounded date range; the rollup
    # reads one task.
    op.create_index(
        "ix_projects_worklogs_org_user_date",
        _WORKLOGS,
        ["organization_id", "user_id", "work_date"],
    )
    op.create_index(f"ix_{_WORKLOGS}_task_id", _WORKLOGS, ["task_id"])

    op.create_table(
        _TIMERS,
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "organization_id",
            sa.Uuid(),
            sa.ForeignKey("login_organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("login_users.id"), nullable=False),
        sa.Column(
            "task_id",
            sa.Uuid(),
            sa.ForeignKey("projects_tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("description", sa.String(), nullable=False, server_default=""),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("accumulated_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("paused_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pause_reason", sa.String(length=20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("organization_id", "user_id", name="uq_projects_timers_org_user"),
    )
    op.create_index(f"ix_{_TIMERS}_task_id", _TIMERS, ["task_id"])

    op.execute(
        sa.text(
            f"""
            INSERT INTO {_WORKLOGS} (
                id, organization_id, task_id, user_id, created_by_user_id, work_date,
                started_at, duration_minutes, description, source, is_deleted,
                created_at, updated_at
            )
            SELECT
                gen_random_uuid(), organization_id, id, owner_id, owner_id,
                (updated_at AT TIME ZONE 'UTC')::date,
                NULL, time_spent_minutes, '', 'import', false, now(), now()
            FROM projects_tasks
            WHERE is_deleted = false AND COALESCE(time_spent_minutes, 0) > 0
            """
        )
    )


def downgrade() -> None:
    op.drop_table(_TIMERS)
    op.drop_table(_WORKLOGS)
