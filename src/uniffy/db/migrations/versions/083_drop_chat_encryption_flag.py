"""Drop the unsupported chat encryption flag.

Revision ID: 083
Revises: 082
Create Date: 2026-08-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "083"
down_revision: str | None = "082"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("chat_channels", "is_encrypted")


def downgrade() -> None:
    op.add_column(
        "chat_channels",
        sa.Column(
            "is_encrypted",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
