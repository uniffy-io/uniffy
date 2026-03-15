"""Add agents domain tables: provider_keys, agents, sessions, messages, skills, run_logs, memories.

Revision ID: 027
Revises: 025
Create Date: 2026-03-03

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "027"
down_revision: str = "025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_visibility_enum = postgresql.ENUM(
    "PRIVATE",
    "GROUP",
    "ORGANIZATION",
    "PUBLIC",
    name="visibilityscope",
    create_type=False,
)


def upgrade() -> None:
    """Create all agents domain tables."""
    # -- Add content types --
    op.execute(sa.text("ALTER TYPE contenttype ADD VALUE IF NOT EXISTS 'AGENT'"))
    op.execute(sa.text("ALTER TYPE contenttype ADD VALUE IF NOT EXISTS 'PROVIDER_KEY'"))

    # -- agents_provider_keys --
    op.create_table(
        "agents_provider_keys",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("credential_type", sa.String(20), nullable=False),
        sa.Column("label", sa.String(255), nullable=False),
        sa.Column("encrypted_credential", sa.Text(), nullable=False),
        sa.Column("key_hint", sa.String(20), nullable=False),
        sa.Column("is_valid", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("visibility", _visibility_enum, nullable=False, server_default="ORGANIZATION"),
        sa.Column("last_validated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["login_users.id"]),
        sa.UniqueConstraint(
            "organization_id",
            "provider",
            "label",
            name="uq_agents_provider_keys_org_provider_label",
        ),
    )
    op.create_index(
        "ix_agents_provider_keys_org_id",
        "agents_provider_keys",
        ["organization_id"],
    )
    op.create_index(
        "ix_agents_provider_keys_org_valid_enabled",
        "agents_provider_keys",
        ["organization_id", "is_valid", "is_enabled"],
    )

    # -- agents_agents --
    op.create_table(
        "agents_agents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("soul_prompt", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column(
            "primary_model",
            sa.String(100),
            nullable=False,
            server_default=sa.text("'claude-sonnet-4-6'"),
        ),
        sa.Column(
            "fallback_models", sa.JSON(), nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
        sa.Column("image_model", sa.String(100), nullable=False, server_default=""),
        sa.Column(
            "primary_provider_key_id",
            sa.Uuid(),
            nullable=True,
            index=True,
        ),
        sa.Column(
            "image_provider_key_id",
            sa.Uuid(),
            nullable=True,
            index=True,
        ),
        sa.Column("enabled_tools", sa.JSON(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column(
            "enabled_skills", sa.JSON(), nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
        sa.Column("avatar_emoji", sa.String(10), nullable=False, server_default=sa.text("''")),
        sa.Column("avatar_key", sa.String(255), nullable=True),
        sa.Column("theme_color", sa.String(50), nullable=False, server_default=sa.text("''")),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("visibility", _visibility_enum, nullable=False, server_default="ORGANIZATION"),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["owner_id"], ["login_users.id"]),
        sa.ForeignKeyConstraint(
            ["primary_provider_key_id"],
            ["agents_provider_keys.id"],
            name="fk_agents_agents_primary_key",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["image_provider_key_id"],
            ["agents_provider_keys.id"],
            name="fk_agents_agents_image_key",
            ondelete="SET NULL",
        ),
    )
    op.create_index("ix_agents_agents_org_id", "agents_agents", ["organization_id"])
    op.execute(
        sa.text(
            "CREATE UNIQUE INDEX uq_agents_agents_default_per_org "
            "ON agents_agents (organization_id) "
            "WHERE is_default = true"
        )
    )

    # -- agents_sessions --
    op.create_table(
        "agents_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("agent_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=True),
        sa.Column("model_override", sa.String(100), nullable=True),
        sa.Column(
            "total_input_tokens", sa.BigInteger(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column(
            "total_output_tokens", sa.BigInteger(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column("message_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("last_model_used", sa.String(100), nullable=True),
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(
            ["agent_id"],
            ["agents_agents.id"],
            name="fk_agents_sessions_agent_id",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"]),
    )
    op.create_index("ix_agents_sessions_org_id", "agents_sessions", ["organization_id"])
    op.create_index("ix_agents_sessions_agent_id", "agents_sessions", ["agent_id"])
    op.create_index("ix_agents_sessions_user_id", "agents_sessions", ["user_id"])

    # -- agents_messages --
    op.create_table(
        "agents_messages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("model", sa.String(100), nullable=True),
        sa.Column("tool_name", sa.String(100), nullable=True),
        sa.Column("tool_call_id", sa.String(100), nullable=True),
        sa.Column("tool_args", sa.JSON(), nullable=True),
        sa.Column("tool_result", sa.Text(), nullable=True),
        sa.Column("is_thinking", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_compacted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["session_id"], ["agents_sessions.id"]),
    )
    op.create_index(
        "ix_agents_messages_session_created",
        "agents_messages",
        ["session_id", "created_at"],
    )

    # -- agents_skills --
    op.create_table(
        "agents_skills",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("owner_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("content", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("always_active", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(
            ["owner_id"],
            ["login_users.id"],
            name="fk_agents_skills_owner_id",
        ),
    )
    op.create_index("ix_agents_skills_org_id", "agents_skills", ["organization_id"])
    op.create_index("ix_agents_skills_owner_id", "agents_skills", ["owner_id"])
    op.execute(
        sa.text(
            "CREATE UNIQUE INDEX uq_agents_skills_org_name "
            "ON agents_skills (organization_id, name) "
            "WHERE organization_id IS NOT NULL"
        )
    )
    op.execute(
        sa.text(
            "CREATE UNIQUE INDEX uq_agents_skills_bundled_name "
            "ON agents_skills (name) "
            "WHERE organization_id IS NULL"
        )
    )

    # -- agents_run_logs --
    op.create_table(
        "agents_run_logs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("agent_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column("provider_key_id", sa.Uuid(), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("tool_calls", sa.JSON(), nullable=True),
        sa.Column("tool_iterations", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("duration_ms", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("status", sa.String(20), nullable=False, server_default=sa.text("'success'")),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["provider_key_id"],
            ["agents_provider_keys.id"],
            name="fk_agents_run_logs_provider_key",
            ondelete="SET NULL",
        ),
    )
    op.create_index(
        "ix_agents_run_logs_org_created",
        "agents_run_logs",
        ["organization_id", "created_at"],
    )
    op.create_index(
        "ix_agents_run_logs_agent_created",
        "agents_run_logs",
        ["agent_id", "created_at"],
    )
    op.create_index(
        "ix_agents_run_logs_key_created",
        "agents_run_logs",
        ["provider_key_id", "created_at"],
    )

    # -- agents_memories --
    op.create_table(
        "agents_memories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("agent_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.String(255), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("category", sa.String(50), nullable=False, server_default=sa.text("'facts'")),
        sa.Column("importance", sa.Float(), nullable=False, server_default=sa.text("0.5")),
        sa.Column("access_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "agent_id",
            "user_id",
            "organization_id",
            "key",
            name="uq_agents_memories_agent_user_org_key",
        ),
    )
    op.create_index(
        "ix_agents_memories_agent_user_org",
        "agents_memories",
        ["agent_id", "user_id", "organization_id"],
    )


def downgrade() -> None:
    """Drop all agents domain tables."""
    op.drop_table("agents_memories")
    op.drop_table("agents_run_logs")
    op.execute(sa.text("DROP INDEX IF EXISTS uq_agents_skills_bundled_name"))
    op.execute(sa.text("DROP INDEX IF EXISTS uq_agents_skills_org_name"))
    op.drop_table("agents_skills")
    op.drop_table("agents_messages")
    op.drop_table("agents_sessions")
    op.execute(sa.text("DROP INDEX IF EXISTS uq_agents_agents_default_per_org"))
    op.drop_table("agents_agents")
    op.drop_table("agents_provider_keys")
