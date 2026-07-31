"""Memory buckets shared by every agent; agent binding survives only on org rows.

Collapses per-agent user/channel/session entries into one bucket per subject,
keeping the most recently updated row per key, and records which agent wrote an
entry in created_by_agent_id.

Revision ID: 066
Revises: 065
Create Date: 2026-07-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "066"
down_revision: str | None = "065"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_BINDING_CHECK = "agent_id IS NULL OR scope = 'org'"

_OLD_INDEXES = (
    "ix_agents_memories_personal",
    "ix_agents_memories_personal_ranked",
    "ix_agents_memories_channel",
    "ix_agents_memories_session",
    "ix_agents_memories_org",
)


def upgrade() -> None:
    op.alter_column("agents_memories", "agent_id", nullable=True)
    op.add_column(
        "agents_memories",
        sa.Column("created_by_agent_id", UUID(as_uuid=True), nullable=True),
    )
    op.execute(sa.text("UPDATE agents_memories SET created_by_agent_id = agent_id"))

    op.execute(
        sa.text(
            "DELETE FROM agents_memories a USING agents_memories b "
            "WHERE a.scope <> 'org' AND b.scope = a.scope AND a.key = b.key "
            "AND a.organization_id = b.organization_id "
            "AND a.user_id IS NOT DISTINCT FROM b.user_id "
            "AND a.channel_id IS NOT DISTINCT FROM b.channel_id "
            "AND a.session_id IS NOT DISTINCT FROM b.session_id "
            "AND (a.updated_at, a.id) < (b.updated_at, b.id)"
        )
    )
    op.execute(sa.text("UPDATE agents_memories SET agent_id = NULL WHERE scope <> 'org'"))

    op.drop_constraint("uq_agents_memories_scope_key", "agents_memories", type_="unique")
    for name in _OLD_INDEXES:
        op.execute(sa.text(f"DROP INDEX IF EXISTS {name}"))

    op.create_unique_constraint(
        "uq_agents_memories_scope_key",
        "agents_memories",
        [
            "organization_id",
            "scope",
            "user_id",
            "channel_id",
            "session_id",
            "agent_id",
            "key",
        ],
        postgresql_nulls_not_distinct=True,
    )
    op.create_check_constraint(
        "agents_memories_agent_binding", "agents_memories", _BINDING_CHECK
    )

    op.create_index(
        "ix_agents_memories_user",
        "agents_memories",
        ["user_id", "organization_id", "importance", "updated_at"],
        postgresql_where=sa.text("scope = 'user'"),
    )
    op.create_index(
        "ix_agents_memories_channel",
        "agents_memories",
        ["channel_id"],
        postgresql_where=sa.text("scope = 'channel'"),
    )
    op.create_index(
        "ix_agents_memories_session",
        "agents_memories",
        ["session_id"],
        postgresql_where=sa.text("scope = 'session'"),
    )
    op.create_index(
        "ix_agents_memories_org",
        "agents_memories",
        ["organization_id", "agent_id"],
        postgresql_where=sa.text("scope = 'org'"),
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE agents_memories SET agent_id = created_by_agent_id "
            "WHERE agent_id IS NULL"
        )
    )
    op.execute(sa.text("DELETE FROM agents_memories WHERE agent_id IS NULL"))

    op.drop_constraint("agents_memories_agent_binding", "agents_memories", type_="check")
    op.drop_constraint("uq_agents_memories_scope_key", "agents_memories", type_="unique")
    for name in (
        "ix_agents_memories_user",
        "ix_agents_memories_channel",
        "ix_agents_memories_session",
        "ix_agents_memories_org",
    ):
        op.execute(sa.text(f"DROP INDEX IF EXISTS {name}"))

    op.drop_column("agents_memories", "created_by_agent_id")
    op.alter_column("agents_memories", "agent_id", nullable=False)

    op.create_unique_constraint(
        "uq_agents_memories_scope_key",
        "agents_memories",
        ["agent_id", "scope", "user_id", "channel_id", "session_id", "key"],
        postgresql_nulls_not_distinct=True,
    )
    op.create_index(
        "ix_agents_memories_personal",
        "agents_memories",
        ["agent_id", "user_id"],
        postgresql_where=sa.text("user_id IS NOT NULL"),
    )
    op.create_index(
        "ix_agents_memories_channel",
        "agents_memories",
        ["agent_id", "channel_id"],
        postgresql_where=sa.text("channel_id IS NOT NULL"),
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
