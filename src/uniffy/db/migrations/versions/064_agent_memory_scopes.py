"""Audience-scoped agent memories: scope column, session subject, provenance, pin tier.

Revision ID: 064
Revises: 063
Create Date: 2026-07-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "064"
down_revision: str | None = "063"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCOPE_CHECK = (
    "(scope = 'user' AND user_id IS NOT NULL AND channel_id IS NULL AND session_id IS NULL)"
    " OR (scope = 'channel' AND channel_id IS NOT NULL AND user_id IS NULL AND session_id IS NULL)"
    " OR (scope = 'session' AND session_id IS NOT NULL AND user_id IS NULL AND channel_id IS NULL)"
    " OR (scope = 'org' AND user_id IS NULL AND channel_id IS NULL AND session_id IS NULL)"
)


def upgrade() -> None:
    op.add_column(
        "agents_memories",
        sa.Column("scope", sa.String(20), nullable=True),
    )
    op.add_column(
        "agents_memories",
        sa.Column(
            "session_id",
            UUID(as_uuid=True),
            sa.ForeignKey("agents_sessions.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.add_column(
        "agents_memories",
        sa.Column("created_by_user_id", UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "agents_memories",
        sa.Column("description", sa.String(255), nullable=True),
    )
    op.add_column(
        "agents_memories",
        sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "agents_memories",
        sa.Column("source", sa.String(10), nullable=False, server_default="tool"),
    )

    op.execute(
        "UPDATE agents_memories SET"
        " scope = 'user',"
        " created_by_user_id = user_id,"
        " description = left(content, 255)"
    )

    op.alter_column("agents_memories", "scope", nullable=False)
    op.alter_column("agents_memories", "created_by_user_id", nullable=False)
    op.alter_column("agents_memories", "description", nullable=False)

    op.drop_constraint(
        "agents_memories_scope_present", "agents_memories", type_="check"
    )
    op.create_check_constraint(
        "agents_memories_scope_consistent", "agents_memories", _SCOPE_CHECK
    )
    op.create_check_constraint(
        "agents_memories_source_valid",
        "agents_memories",
        "source IN ('tool', 'manual')",
    )

    op.drop_constraint(
        "uq_agents_memories_agent_user_channel_key", "agents_memories", type_="unique"
    )
    op.create_unique_constraint(
        "uq_agents_memories_scope_key",
        "agents_memories",
        ["agent_id", "scope", "user_id", "channel_id", "session_id", "key"],
        postgresql_nulls_not_distinct=True,
    )

    op.create_index(
        "ix_agents_memories_session",
        "agents_memories",
        ["agent_id", "session_id"],
        postgresql_where=sa.text("session_id IS NOT NULL"),
    )
    op.create_index(
        "ix_agents_memories_org",
        "agents_memories",
        ["agent_id"],
        postgresql_where=sa.text("scope = 'org'"),
    )


def downgrade() -> None:
    op.drop_index("ix_agents_memories_org", table_name="agents_memories")
    op.drop_index("ix_agents_memories_session", table_name="agents_memories")
    op.drop_constraint("uq_agents_memories_scope_key", "agents_memories", type_="unique")
    op.create_unique_constraint(
        "uq_agents_memories_agent_user_channel_key",
        "agents_memories",
        ["agent_id", "user_id", "channel_id", "key"],
        postgresql_nulls_not_distinct=True,
    )
    op.drop_constraint("agents_memories_source_valid", "agents_memories", type_="check")
    op.drop_constraint(
        "agents_memories_scope_consistent", "agents_memories", type_="check"
    )
    op.create_check_constraint(
        "agents_memories_scope_present",
        "agents_memories",
        "user_id IS NOT NULL OR channel_id IS NOT NULL",
    )
    op.execute("DELETE FROM agents_memories WHERE scope IN ('session', 'org')")
    op.drop_column("agents_memories", "source")
    op.drop_column("agents_memories", "pinned")
    op.drop_column("agents_memories", "description")
    op.drop_column("agents_memories", "created_by_user_id")
    op.drop_column("agents_memories", "session_id")
    op.drop_column("agents_memories", "scope")
