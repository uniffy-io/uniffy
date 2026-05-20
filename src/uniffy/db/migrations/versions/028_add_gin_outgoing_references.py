"""Add GIN index on notes_notes.outgoing_references.

Revision ID: 028
Revises: 027
Create Date: 2026-05-18

Backs ``Note.outgoing_references.contains([target_urn])`` so backlink
queries use a bitmap index scan instead of a sequential scan.
``jsonb_path_ops`` is smaller and faster than ``jsonb_ops`` for the
``@>`` queries this column supports. Built ``CONCURRENTLY`` to keep
the operation lock-free on a populated table.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "028"
down_revision: str | None = "027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_INDEX_NAME = "ix_notes_outgoing_references_gin"
_CREATE_SQL = (
    f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {_INDEX_NAME} "
    "ON notes_notes USING GIN (outgoing_references jsonb_path_ops)"
)
_DROP_SQL = f"DROP INDEX CONCURRENTLY IF EXISTS {_INDEX_NAME}"


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(_CREATE_SQL)


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(_DROP_SQL)
