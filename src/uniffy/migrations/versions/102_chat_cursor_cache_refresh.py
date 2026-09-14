"""Recover PostgreSQL cursor writes made while the cache is unavailable."""

import sqlalchemy as sa
from alembic import op

revision = "102"
down_revision = "101"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "chat_read_cursors",
        sa.Column(
            "needs_cache_refresh",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.create_index(
        "ix_chat_read_cursor_cache_refresh",
        "chat_read_cursors",
        ["revision"],
        postgresql_where=sa.text("needs_cache_refresh"),
    )


def downgrade() -> None:
    op.drop_index("ix_chat_read_cursor_cache_refresh", table_name="chat_read_cursors")
    op.drop_column("chat_read_cursors", "needs_cache_refresh")
