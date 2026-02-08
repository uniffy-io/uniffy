"""Create notes table.

Revision ID: 004
Revises: 003
Create Date: 2026-01-20

"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "004"
down_revision: str | None = "003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create notes table."""
    op.create_table(
        "notes_notes",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column(
            "visibility",
            postgresql.ENUM(
                "PRIVATE",
                "GROUP",
                "ORGANIZATION",
                "PUBLIC",
                name="visibilityscope",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column(
            "node_type",
            postgresql.ENUM("NOTE", "FOLDER", "TEMPLATE", name="nodetype", create_type=False),
            nullable=False,
            server_default="NOTE",
        ),
        sa.Column("title", sqlmodel.sql.sqltypes.AutoString(length=500), nullable=False),
        sa.Column(
            "content", sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default="''"
        ),
        sa.Column("slug", sqlmodel.sql.sqltypes.AutoString(length=500), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column("tags", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("note_metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("outgoing_references", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "content_search",
            postgresql.TSVECTOR(),
            server_default=sa.text("to_tsvector('english', '')"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["owner_id"], ["login_users.id"]),
        sa.ForeignKeyConstraint(["parent_id"], ["notes_notes.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_notes_notes_organization_id", "notes_notes", ["organization_id"], unique=False
    )
    op.create_index("ix_notes_notes_owner_id", "notes_notes", ["owner_id"], unique=False)
    op.create_index("ix_notes_notes_visibility", "notes_notes", ["visibility"], unique=False)
    op.create_index("ix_notes_notes_node_type", "notes_notes", ["node_type"], unique=False)
    op.create_index("ix_notes_notes_slug", "notes_notes", ["slug"], unique=False)
    op.create_index("ix_notes_notes_parent_id", "notes_notes", ["parent_id"], unique=False)


def downgrade() -> None:
    """Drop notes table."""
    op.drop_table("notes_notes")
