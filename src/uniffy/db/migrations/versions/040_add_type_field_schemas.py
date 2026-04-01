"""Add type_field_schemas to projects.

Revision ID: 040
Revises: 039
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "040"
down_revision = "039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add type_field_schemas JSONB column to projects table."""
    op.add_column(
        "projects_projects",
        sa.Column("type_field_schemas", JSONB, nullable=True),
    )


def downgrade() -> None:
    """Remove type_field_schemas column."""
    op.drop_column("projects_projects", "type_field_schemas")
