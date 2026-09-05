"""Remove organization-wide rule selections without changing agent selections."""

from alembic import op

revision = "099"
down_revision = "098"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DELETE FROM org_settings WHERE namespace = 'agents' AND key = 'enabled_rules'")


def downgrade() -> None:
    # Deleted selections cannot be reconstructed; no schema was changed.
    pass
