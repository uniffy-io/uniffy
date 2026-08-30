"""Add last_output_token_estimate to agents_channel_bindings.

Revision ID: 018
Revises: 017
Create Date: 2026-05-06

The chat agent runtime already caches the provider-reported prompt size
on ``last_active_token_estimate`` after each turn. The context meter
now also surfaces the matching output (completion) size so the UI can
split the displayed total into "what the model ingested" vs "what it
generated". Both columns are written together by
``ChatChannelMessageWriter._record_active_tokens``.

Defaults to 0 so existing rows remain valid; the next live agent turn
populates the real value.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "018"
down_revision: str | None = "017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "agents_channel_bindings",
        sa.Column(
            "last_output_token_estimate",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("agents_channel_bindings", "last_output_token_estimate")
