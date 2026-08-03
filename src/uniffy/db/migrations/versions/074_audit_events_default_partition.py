"""Add a DEFAULT partition to audit_events.

Revision ID: 074
Revises: 073
Create Date: 2026-08-02

Revision 039 pre-created four monthly partitions relative to its own run date,
so a deployment eventually reaches a month with no partition and every audited
write fails on a check violation, taking its business transaction with it. The
worker now provisions months on boot and daily, and this default partition is
the floor under that: a write can land somewhere even when provisioning has not
run. The provisioning routine drains it into the real partition it creates.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "074"
down_revision: str | None = "073"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "CREATE TABLE IF NOT EXISTS audit_events_default "
        "PARTITION OF audit_events DEFAULT"
    )


def downgrade() -> None:
    """Dropping the default discards any rows provisioning has not drained yet."""
    op.execute("DROP TABLE IF EXISTS audit_events_default")
