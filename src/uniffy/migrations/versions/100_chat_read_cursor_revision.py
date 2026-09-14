"""Order channel cursor writes independently of read position."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "100"
down_revision: str | None = "099"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "chat_read_cursors",
        sa.Column(
            "revision",
            sa.Uuid(),
            nullable=False,
            server_default="00000000-0000-0000-0000-000000000000",
        ),
    )


def downgrade() -> None:
    op.drop_column("chat_read_cursors", "revision")
