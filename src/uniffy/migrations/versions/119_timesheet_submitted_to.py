"""Record which reviewer a timesheet was submitted to."""

import sqlalchemy as sa
from alembic import op

revision: str = "119"
down_revision: str | None = "118"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "projects_timesheets",
        sa.Column(
            "submitted_to_user_id", sa.Uuid(), sa.ForeignKey("login_users.id"), nullable=True
        ),
    )


def downgrade() -> None:
    op.drop_column("projects_timesheets", "submitted_to_user_id")
