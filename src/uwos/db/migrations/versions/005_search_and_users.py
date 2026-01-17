"""Create search index with composite primary key.

Revision ID: 005
Revises: 004
Create Date: 2026-01-17

This migration creates the search_index table with:
1. Proper composite primary key (urn, organization_id) from the start
2. All necessary indexes for search functionality
3. pg_trgm extension for fuzzy search support

"""

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "005"
down_revision: str | None = "004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create search index table with proper composite primary key."""
    # Enable pg_trgm extension for fuzzy search
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # Search Index table with proper composite primary key from the start
    op.create_table(
        "search_index",
        sa.Column("urn", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("title", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("description", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("keywords", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("entity_type", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("url_path", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("visibility", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("shared_group_ids", postgresql.ARRAY(sa.UUID()), nullable=True),
        sa.Column("shared_user_ids", postgresql.ARRAY(sa.UUID()), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rank_score", sa.FLOAT(), server_default="1.0", nullable=True),
        sa.PrimaryKeyConstraint("urn", "organization_id"),
    )

    # Create indexes for search functionality
    op.create_index(
        "ix_search_index_organization_id", "search_index", ["organization_id"], unique=False
    )
    op.create_index("ix_search_index_visibility", "search_index", ["visibility"], unique=False)

    # Trigram index for fuzzy search on keywords
    op.create_index(
        "ix_search_trgm",
        "search_index",
        ["keywords"],
        postgresql_using="gin",
        postgresql_ops={"keywords": "gin_trgm_ops"},
    )

    # GIN index for permission array overlaps
    op.create_index(
        "ix_search_perm",
        "search_index",
        ["shared_group_ids", "shared_user_ids"],
        postgresql_using="gin",
    )


def downgrade() -> None:
    """Drop search index table and extension."""
    op.drop_index("ix_search_perm", table_name="search_index")
    op.drop_index("ix_search_trgm", table_name="search_index")
    op.drop_index("ix_search_index_visibility", table_name="search_index")
    op.drop_index("ix_search_index_organization_id", table_name="search_index")
    op.drop_table("search_index")
    op.execute("DROP EXTENSION IF EXISTS pg_trgm")
