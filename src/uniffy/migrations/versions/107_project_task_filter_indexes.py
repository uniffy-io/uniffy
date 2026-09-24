"""Index the task columns a view filter narrows by, and add the collation task sorts use.

Revision ID: 107
Revises: 106
Create Date: 2026-09-23

The indexes are built ``CONCURRENTLY`` so a populated ``projects_tasks`` keeps taking writes.
``natural_sort`` is an ICU collation: case- and accent-blind, digits compared as numbers.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "107"
down_revision: str | None = "106"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_COLLATION = "natural_sort"
_INDEXES = {
    # jsonb_ops answers the ?| and ?& a person condition compiles to.
    "ix_projects_tasks_assignee_ids": "USING GIN (assignee_ids)",
    # jsonb_path_ops is the smaller index and answers the @> a custom field condition compiles to.
    "ix_projects_tasks_field_values": "USING GIN (field_values jsonb_path_ops)",
    "ix_projects_tasks_project_due_date": "(project_id, due_date)",
}


def upgrade() -> None:
    op.execute(
        f"CREATE COLLATION IF NOT EXISTS {_COLLATION} "
        "(provider = icu, locale = 'und-u-kn-ks-level1', deterministic = false)"
    )
    with op.get_context().autocommit_block():
        for name, definition in _INDEXES.items():
            op.execute(
                f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} ON projects_tasks {definition}"
            )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        for name in reversed(_INDEXES):
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
    op.execute(f"DROP COLLATION IF EXISTS {_COLLATION}")
