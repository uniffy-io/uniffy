"""Make ``audit_events.organization_id`` nullable.

Revision ID: 040
Revises: 039
Create Date: 2026-05-20

The column is nullable in the model so events that genuinely lack a
tenant (login failure for an unknown email, self-driven session
termination before an org context resolves) can be recorded without
inventing a fake organization. Earlier revisions of ``039`` created the
column ``NOT NULL``; this revision relaxes it. The ALTER on the
partitioned parent propagates to every existing and future partition.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "040"
down_revision: str | None = "039"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Drop NOT NULL on ``audit_events.organization_id``."""
    op.execute("ALTER TABLE audit_events ALTER COLUMN organization_id DROP NOT NULL")


def downgrade() -> None:
    """Restore NOT NULL. Any existing NULL rows must be cleared first."""
    op.execute(
        "ALTER TABLE audit_events ALTER COLUMN organization_id SET NOT NULL"
    )
