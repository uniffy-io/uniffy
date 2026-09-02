"""Queue of search-index removals that failed inline.

Revision ID: 063
Revises: 062
Create Date: 2026-07-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "063"
down_revision: str | None = "062"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "search_removal_queue",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("urn", sa.String(length=255), nullable=True),
        sa.Column("filter_expr", sa.Text(), nullable=True),
        sa.Column("organization_id", UUID(as_uuid=True), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "urn IS NOT NULL OR filter_expr IS NOT NULL",
            name="ck_search_removal_target",
        ),
    )
    op.create_index(
        "ix_search_removal_queue_created_at",
        "search_removal_queue",
        ["created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_search_removal_queue_created_at", table_name="search_removal_queue")
    op.drop_table("search_removal_queue")
