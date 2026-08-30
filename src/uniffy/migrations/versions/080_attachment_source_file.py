"""Record the source file an attachment was copied from.

Revision ID: 080
Revises: 079
Create Date: 2026-08-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "080"
down_revision: str | None = "079"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "attachments_attachments",
        sa.Column("source_file_id", sa.Uuid(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("attachments_attachments", "source_file_id")
