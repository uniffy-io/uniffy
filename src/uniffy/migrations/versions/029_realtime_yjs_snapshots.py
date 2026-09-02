"""Realtime CRDT snapshot table.

Revision ID: 029
Revises: 028
Create Date: 2026-05-18

Creates ``realtime_yjs_snapshots``: a domain-agnostic compacted Yjs
blob keyed by ``(content_type, content_id)``. New content types plug
in via ``RealtimeContentAdapter`` with no per-domain schema work.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "029"
down_revision: str | None = "028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_content_type_enum = postgresql.ENUM(
    "NOTE",
    "FILE",
    "FOLDER",
    "CALENDAR_EVENT",
    "CHAT_MESSAGE",
    "USER",
    "PROJECT",
    "TASK",
    "AGENT",
    "PROVIDER_KEY",
    "PROMPT",
    "AGENT_CRON_TASK",
    "CHAT",
    "ROOM",
    name="contenttype",
    create_type=False,
)


def upgrade() -> None:
    op.create_table(
        "realtime_yjs_snapshots",
        sa.Column("content_type", _content_type_enum, nullable=False),
        sa.Column("content_id", sa.Uuid(), nullable=False),
        sa.Column("state_vector", sa.LargeBinary(), nullable=False),
        sa.Column("updates", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("content_type", "content_id"),
    )


def downgrade() -> None:
    op.drop_table("realtime_yjs_snapshots")
