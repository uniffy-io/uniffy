"""Drop unused notes_notes.content_search TSVECTOR column.

Revision ID: 027
Revises: 026
Create Date: 2026-05-18

Notes search is served by Meilisearch; the Postgres TSVECTOR column
was never read. Dropping the column reclaims disk on every notes row.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "027"
down_revision: str | None = "026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("notes_notes", "content_search")


def downgrade() -> None:
    op.add_column(
        "notes_notes",
        sa.Column(
            "content_search",
            postgresql.TSVECTOR(),
            server_default=sa.text("to_tsvector('english', '')"),
            nullable=True,
        ),
    )
