"""Backfill completed_at on tasks already sitting in the done column.

Completion is measured off completed_at rather than off the status id. Tasks
created straight into status_done never had it stamped, so without this backfill
they read as open in every rollup and progress bar.

Revision ID: 078
Revises: 077
Create Date: 2026-08-06
"""

from collections.abc import Sequence

from alembic import op

revision: str = "078"
down_revision: str | None = "077"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE projects_tasks
        SET completed_at = COALESCE(updated_at, created_at)
        WHERE status = 'status_done' AND completed_at IS NULL
        """
    )


def downgrade() -> None:
    # The stamp is indistinguishable from one a status change wrote, so clearing
    # it would drop real completion timestamps too.
    pass
