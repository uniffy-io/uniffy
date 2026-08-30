"""Drop the agents_messages.token_estimate column.

Revision ID: 017
Revises: 016
Create Date: 2026-05-06

The runtime no longer estimates per-message tokens via a chars/4
heuristic. Active context size is now read directly from the
provider-reported ``input_tokens`` + ``output_tokens`` of the latest
non-compacted assistant message (the only ground truth for "what the
model just ingested"). Compaction sizing dropped the per-row token
budget along with it.

Downgrade re-adds the column with a default of 0 (no backfill -- the
estimator is gone).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "017"
down_revision: str | None = "016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("agents_messages", "token_estimate")


def downgrade() -> None:
    op.add_column(
        "agents_messages",
        sa.Column(
            "token_estimate",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
