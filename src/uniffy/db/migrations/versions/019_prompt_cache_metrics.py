"""Track prompt-cache hits on assistant turns.

Revision ID: 019
Revises: 018
Create Date: 2026-05-06

The Anthropic provider now caches the (tools + system) prefix via
``cache_control: {"type": "ephemeral"}`` breakpoints. Each completion
returns ``cache_read_input_tokens`` -- the share of the prompt that
hit the cache and was billed at ~10% of the base input price. We
store that on every assistant turn so the meter can show how much of
the displayed input was free, and so cache regressions are observable
instead of silent.

Two columns:

- ``agents_messages.cache_read_input_tokens`` (per-turn, session path)
- ``agents_channel_bindings.last_cache_read_token_estimate`` (latest
  turn, chat path -- mirrors the existing ``last_active_token_estimate``
  + ``last_output_token_estimate`` pair).

Both default to 0; existing rows are valid as-is and the next live
turn populates the real value.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "019"
down_revision: str | None = "018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "agents_messages",
        sa.Column(
            "cache_read_input_tokens",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "agents_channel_bindings",
        sa.Column(
            "last_cache_read_token_estimate",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column(
        "agents_channel_bindings", "last_cache_read_token_estimate"
    )
    op.drop_column("agents_messages", "cache_read_input_tokens")
