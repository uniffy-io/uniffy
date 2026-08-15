"""Hot-row FILLFACTOR + autovac tuning on agents_sessions.

Revision ID: 014
Revises: 013
Create Date: 2026-04-25

``agents_sessions`` rows receive multiple counter updates per agent
turn (``message_count``, ``total_input_tokens``,
``total_output_tokens``, ``last_model_used``, ``updated_at``). Without
free space on the page each UPDATE has to migrate the row, killing the
HOT-update fast path and bloating the table. FILLFACTOR=80 leaves
room for in-place updates; tighter autovac thresholds keep dead-tuple
churn contained.

Already covered by earlier migrations and verified -- this revision is
agents_sessions only:

  - chat_channel_stats / chat_thread_stats: FILLFACTOR=70 (011_chat)
  - chat_messages: FILLFACTOR=90 (011_chat)
  - agents_channel_bindings: FILLFACTOR=80 (012_agents)

Note: ALTER TABLE ... SET (fillfactor=...) only affects new pages.
Existing pages keep their old fill ratio until rewritten. To apply the
new fillfactor to existing rows run ``pg_repack`` (or VACUUM FULL in a
maintenance window) separately - this migration intentionally does not
attempt that, since pg_repack is an online external tool and VACUUM
FULL takes an ACCESS EXCLUSIVE lock.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "014"
down_revision: str | None = "013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_FILLFACTOR_AND_AUTOVAC = (
    "fillfactor = 80, autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02"
)


def upgrade() -> None:
    """Apply FILLFACTOR=80 + tight autovac to agents_sessions."""
    op.execute(sa.text(f"ALTER TABLE agents_sessions SET ({_FILLFACTOR_AND_AUTOVAC})"))


def downgrade() -> None:
    """Reset agents_sessions storage parameters to defaults."""
    op.execute(
        sa.text(
            "ALTER TABLE agents_sessions RESET ("
            "fillfactor, "
            "autovacuum_vacuum_scale_factor, "
            "autovacuum_analyze_scale_factor"
            ")"
        )
    )
