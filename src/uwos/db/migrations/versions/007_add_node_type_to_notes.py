"""add node_type to notes

Revision ID: 007
Revises: 006
Create Date: 2026-01-11 12:00:00.000000

"""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add node_type column to notes_notes table."""
    # Create the nodetype enum type
    nodetype_enum = sa.Enum("NOTE", "FOLDER", "TEMPLATE", name="nodetype", create_type=False)
    nodetype_enum.create(op.get_bind(), checkfirst=True)

    # Add node_type column with default value 'NOTE' for existing rows
    op.add_column(
        "notes_notes",
        sa.Column(
            "node_type",
            sa.Enum("NOTE", "FOLDER", "TEMPLATE", name="nodetype"),
            nullable=False,
            server_default="NOTE",
        ),
    )
    # Add index for node_type
    op.create_index(
        op.f("ix_notes_notes_node_type"),
        "notes_notes",
        ["node_type"],
        unique=False,
    )


def downgrade() -> None:
    """Remove node_type column from notes_notes table."""
    op.drop_index(op.f("ix_notes_notes_node_type"), table_name="notes_notes")
    op.drop_column("notes_notes", "node_type")
    # Drop the enum type
    sa.Enum("NOTE", "FOLDER", "TEMPLATE", name="nodetype").drop(op.get_bind(), checkfirst=True)
    # Drop the enum type
    sa.Enum("NOTE", "FOLDER", "TEMPLATE", name="nodetype").drop(op.get_bind(), checkfirst=True)
