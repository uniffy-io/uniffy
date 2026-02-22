"""Fix slug unique constraint to allow re-use after soft-delete.

Replace the plain unique constraint on (organization_id, slug) with a
partial unique index that only applies to non-deleted projects.

Revision ID: 025
Revises: 024
Create Date: 2026-02-20

"""

from alembic import op

revision = "025"
down_revision = "024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Replace unique constraint with partial index excluding soft-deleted rows."""
    op.drop_constraint("uq_projects_slug_per_org", "projects_projects", type_="unique")
    op.execute(
        """
        CREATE UNIQUE INDEX uq_projects_slug_per_org
        ON projects_projects (organization_id, slug)
        WHERE is_deleted = false
        """
    )


def downgrade() -> None:
    """Restore original unique constraint."""
    op.execute("DROP INDEX IF EXISTS uq_projects_slug_per_org")
    op.create_unique_constraint(
        "uq_projects_slug_per_org",
        "projects_projects",
        ["organization_id", "slug"],
    )
