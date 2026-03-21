"""Add type_field_schemas to projects.

Revision ID: 036
Revises: 035
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "036"
down_revision = "035"
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
