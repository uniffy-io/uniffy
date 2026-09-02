"""Performance indexes for chat + agents hot paths.

Revision ID: 013
Revises: 012
Create Date: 2026-04-25

Adds six covering / partial indexes for chat + agents hot paths. Each
statement uses ``CREATE INDEX CONCURRENTLY`` so the migration is safe
to apply on a live database without taking write locks. Concurrent
index creation cannot run inside a transaction, hence each statement
is wrapped in its own ``autocommit_block``.

Targets:
  - chat_thread_read_cursors(user_id) -- sidebar "all unread thread badges"
  - agents_agents(organization_id, updated_at DESC) WHERE NOT is_deleted
  - agents_sessions(user_id, organization_id, updated_at DESC) WHERE NOT is_archived
  - agents_messages(session_id, created_at DESC) WHERE active+non-summary
  - agents_provider_keys(organization_id) WHERE valid AND enabled
  - agents_memories(agent_id, user_id, importance DESC, updated_at DESC)
"""

from collections.abc import Sequence

from alembic import op

revision: str = "013"
down_revision: str | None = "012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_INDEXES: tuple[tuple[str, str], ...] = (
    (
        "ix_chat_thread_read_cursors_user",
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
        "ix_chat_thread_read_cursors_user "
        "ON chat_thread_read_cursors (user_id)",
    ),
    (
        "ix_agents_agents_org_active",
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
        "ix_agents_agents_org_active "
        "ON agents_agents (organization_id, updated_at DESC) "
        "WHERE is_deleted = false",
    ),
    (
        "ix_agents_sessions_user_org_updated",
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
        "ix_agents_sessions_user_org_updated "
        "ON agents_sessions (user_id, organization_id, updated_at DESC) "
        "WHERE is_archived = false",
    ),
    (
        "ix_agents_messages_session_active",
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
        "ix_agents_messages_session_active "
        "ON agents_messages (session_id, created_at DESC) "
        "WHERE is_compacted = false AND role <> 'summary'",
    ),
    (
        "ix_agents_provider_keys_active",
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
        "ix_agents_provider_keys_active "
        "ON agents_provider_keys (organization_id) "
        "WHERE is_valid = true AND is_enabled = true",
    ),
    (
        "ix_agents_memories_personal_ranked",
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS "
        "ix_agents_memories_personal_ranked "
        "ON agents_memories (agent_id, user_id, importance DESC, updated_at DESC)",
    ),
)


def upgrade() -> None:
    """Create six performance indexes concurrently."""
    for _name, statement in _INDEXES:
        with op.get_context().autocommit_block():
            op.execute(statement)


def downgrade() -> None:
    """Drop the six performance indexes concurrently."""
    for name, _statement in reversed(_INDEXES):
        with op.get_context().autocommit_block():
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
