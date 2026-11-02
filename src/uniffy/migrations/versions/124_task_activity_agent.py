"""Record which agent made a task change on a person's behalf."""

import sqlalchemy as sa
from alembic import op

revision: str = "124"
down_revision: str | None = "123"
branch_labels: str | None = None
depends_on: str | None = None

_TABLE = "projects_activities"
_COLUMN = "agent_id"
_AGENT_FK = "fk_projects_activities_agent"
_AGENT_INDEX = "ix_projects_activities_agent_id"


def upgrade() -> None:
    op.add_column(_TABLE, sa.Column(_COLUMN, sa.Uuid(), nullable=True))
    op.create_foreign_key(_AGENT_FK, _TABLE, "agents_agents", [_COLUMN], ["id"], ondelete="SET NULL")
    # Partial: agent changes are a small share of history, and the index only serves the FK.
    op.create_index(
        _AGENT_INDEX, _TABLE, [_COLUMN], postgresql_where=sa.text("agent_id IS NOT NULL")
    )


def downgrade() -> None:
    op.drop_index(_AGENT_INDEX, table_name=_TABLE)
    op.drop_constraint(_AGENT_FK, _TABLE, type_="foreignkey")
    op.drop_column(_TABLE, _COLUMN)
