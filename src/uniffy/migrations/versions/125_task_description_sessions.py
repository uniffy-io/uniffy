"""Index each editor's latest task description session."""

import sqlalchemy as sa
from alembic import op

revision: str = "125"
down_revision: str | None = "124"
branch_labels: str | None = None
depends_on: str | None = None

_INDEX = "ix_projects_activities_description_session"


def upgrade() -> None:
    op.create_index(
        _INDEX,
        "projects_activities",
        ["task_id", "actor_id", "agent_id", sa.text("timestamp DESC"), sa.text("id DESC")],
        postgresql_where=sa.text("action = 'description_edited'"),
    )


def downgrade() -> None:
    op.drop_index(_INDEX, table_name="projects_activities")
