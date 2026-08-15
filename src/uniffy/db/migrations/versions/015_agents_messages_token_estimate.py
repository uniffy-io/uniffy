"""Add token_estimate column to agents_messages with backfill.

Revision ID: 015
Revises: 014
Create Date: 2026-04-26

The runtime context loader used to estimate every message's token cost on
every request via a Python ``len(content) // 4`` heuristic. That made
``get_session_context`` O(N) over the read path even though the value is
trivially derivable at INSERT time. This migration stores the estimate
on the row so the read path becomes a single window-function query.

Backfill walks the table in 5,000-row chunks. Each chunk computes the
estimate in Python (mirrors the existing ``_estimate_message_tokens``
helper -- chars / 4 plus tool_args / tool_result overhead) and writes
back via a single UPDATE keyed by ``id``. Chunked so the migration is
safe to run on a large table without holding a single huge transaction.
"""

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "015"
down_revision: str | None = "014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_BACKFILL_CHUNK_SIZE = 5_000


def _estimate_tokens(content: str | None, tool_args, tool_result: str | None) -> int:
    """Mirror of ``_estimate_message_tokens``. Kept in-migration to avoid
    cross-version drift if the helper later changes."""
    chars = len(content or "")
    if tool_args is not None:
        try:
            chars += len(json.dumps(tool_args))
        except TypeError, ValueError:
            chars += 100
    if tool_result:
        chars += len(tool_result)
    chars += 20
    return max(1, chars // 4)


def upgrade() -> None:
    """Add the column with a default of 0, backfill, then keep NOT NULL."""
    op.add_column(
        "agents_messages",
        sa.Column(
            "token_estimate",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )

    bind = op.get_bind()
    last_id: str | None = None
    while True:
        if last_id is None:
            select_stmt = sa.text(
                "SELECT id, content, tool_args, tool_result "
                "FROM agents_messages "
                "ORDER BY id "
                f"LIMIT {_BACKFILL_CHUNK_SIZE}"
            )
            rows = bind.execute(select_stmt).fetchall()
        else:
            select_stmt = sa.text(
                "SELECT id, content, tool_args, tool_result "
                "FROM agents_messages "
                "WHERE id > :last_id "
                "ORDER BY id "
                f"LIMIT {_BACKFILL_CHUNK_SIZE}"
            )
            rows = bind.execute(select_stmt, {"last_id": last_id}).fetchall()

        if not rows:
            break

        update_stmt = sa.text("UPDATE agents_messages SET token_estimate = :te WHERE id = :id")
        for row in rows:
            estimate = _estimate_tokens(row.content, row.tool_args, row.tool_result)
            bind.execute(update_stmt, {"te": estimate, "id": row.id})

        last_id = rows[-1].id
        if len(rows) < _BACKFILL_CHUNK_SIZE:
            break


def downgrade() -> None:
    """Drop the token_estimate column."""
    op.drop_column("agents_messages", "token_estimate")
