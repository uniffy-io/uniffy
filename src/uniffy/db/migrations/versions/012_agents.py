"""Create agents domain tables.

Revision ID: 012
Revises: 011
Create Date: 2026-03-03

Consolidates (original dates):
  - provider_keys, agents, sessions, messages, skills, run_logs, memories (2026-03-03)
  - cron_tasks + cron_run_logs (2026-03-07)
  - prompts + prompt_id on agents (2026-03-08)
  - messages.file_ids (2026-03-08)
  - agents_audit_logs (2026-03-09)
  - channel_bindings + approval_audit (2026-04-17)
  - memories channel scope + CHECK + NULLS NOT DISTINCT unique (2026-04-17)
  - run_logs.session_id nullable + channel_id (2026-04-22)
  - channel_bindings context state cols (2026-04-23)

Final state:
  - provider_keys, agents (with prompt_id), sessions, messages
  - skills, prompts (scoped org-or-bundled unique via partial indexes)
  - cron_tasks (+ partial "due" index) + cron_run_logs
  - memories with (agent, user|channel|both) scopes, CHECK + NULLS NOT
    DISTINCT unique, partial indexes per scope
  - run_logs with nullable session_id + channel_id for chat-triggered runs
  - audit_logs, approval_audit
  - channel_bindings with context state columns (last_active_token_estimate,
    manual_reset_at), FILLFACTOR 80, autovac tight, CHECK constraints
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "012"
down_revision: str | None = "011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_access_mode_enum = postgresql.ENUM(
    "OWNER_ONLY", "EXPLICIT_MEMBERS", "OPEN_TO_ORG", name="accessmode", create_type=False
)
_content_role_enum = postgresql.ENUM(
    "OWNER",
    "ADMIN",
    "EDITOR",
    "COMMENTER",
    "VIEWER",
    "BLOCKED",
    name="contentrole",
    create_type=False,
)

_now = sa.text("now()")
_false = sa.text("false")
_true = sa.text("true")
_zero = sa.text("0")
_tz = sa.DateTime(timezone=True)


def upgrade() -> None:
    """Create agents domain tables."""
    op.create_table(
        "agents_provider_keys",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("credential_type", sa.String(20), nullable=False),
        sa.Column("label", sa.String(255), nullable=False),
        sa.Column("encrypted_credential", sa.Text(), nullable=False),
        sa.Column("key_hint", sa.String(20), nullable=False),
        sa.Column("is_valid", sa.Boolean(), nullable=False, server_default=_true),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=_true),
        sa.Column(
            "access_mode", _access_mode_enum, nullable=False, server_default="OWNER_ONLY"
        ),
        sa.Column("baseline_role", _content_role_enum, nullable=True),
        sa.Column("last_validated_at", _tz, nullable=True),
        sa.Column("last_used_at", _tz, nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", _tz, nullable=False, server_default=_now),
        sa.Column("updated_at", _tz, nullable=False, server_default=_now),
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
        "ix_agents_provider_keys_org_id", "agents_provider_keys", ["organization_id"]
    )
    op.create_index(
        "ix_agents_provider_keys_org_valid_enabled",
        "agents_provider_keys",
        ["organization_id", "is_valid", "is_enabled"],
    )

    op.create_table(
        "agents_prompts",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=True),
        sa.Column(
            "access_mode", _access_mode_enum, nullable=False, server_default="OPEN_TO_ORG"
        ),
        sa.Column("baseline_role", _content_role_enum, nullable=True, server_default="VIEWER"),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("created_at", _tz, nullable=False),
        sa.Column("updated_at", _tz, nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
    )
    op.create_index(
        "ix_agents_prompts_organization_id", "agents_prompts", ["organization_id"]
    )
    op.create_index("ix_agents_prompts_access_mode", "agents_prompts", ["access_mode"])
    op.create_index(
        "uq_agents_prompts_org_name",
        "agents_prompts",
        ["organization_id", "name"],
        unique=True,
        postgresql_where=sa.text("organization_id IS NOT NULL"),
    )
    op.create_index(
        "uq_agents_prompts_bundled_name",
        "agents_prompts",
        ["name"],
        unique=True,
        postgresql_where=sa.text("organization_id IS NULL"),
    )

    op.create_table(
        "agents_agents",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("soul_prompt", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "primary_model",
            sa.String(100),
            nullable=False,
            server_default="claude-sonnet-4-6",
        ),
        sa.Column(
            "fallback_models",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("image_model", sa.String(100), nullable=False, server_default=""),
        sa.Column("primary_provider_key_id", sa.Uuid(), nullable=True),
        sa.Column("image_provider_key_id", sa.Uuid(), nullable=True),
        sa.Column("prompt_id", sa.Uuid(), nullable=True),
        sa.Column(
            "enabled_tools",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "enabled_skills",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("avatar_emoji", sa.String(10), nullable=False, server_default=""),
        sa.Column("avatar_key", sa.String(255), nullable=True),
        sa.Column("theme_color", sa.String(50), nullable=False, server_default=""),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=_false),
        sa.Column(
            "access_mode", _access_mode_enum, nullable=False, server_default="OPEN_TO_ORG"
        ),
        sa.Column("baseline_role", _content_role_enum, nullable=True, server_default="VIEWER"),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=_false),
        sa.Column("deleted_at", _tz, nullable=True),
        sa.Column("created_at", _tz, nullable=False, server_default=_now),
        sa.Column("updated_at", _tz, nullable=False, server_default=_now),
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
        sa.ForeignKeyConstraint(
            ["prompt_id"],
            ["agents_prompts.id"],
            name="fk_agents_agents_prompt_id",
            ondelete="SET NULL",
        ),
    )
    op.create_index("ix_agents_agents_org_id", "agents_agents", ["organization_id"])
    op.create_index(
        "ix_agents_agents_primary_provider_key_id",
        "agents_agents",
        ["primary_provider_key_id"],
    )
    op.create_index(
        "ix_agents_agents_image_provider_key_id",
        "agents_agents",
        ["image_provider_key_id"],
    )
    op.create_index("ix_agents_agents_prompt_id", "agents_agents", ["prompt_id"])
    op.create_index("ix_agents_agents_access_mode", "agents_agents", ["access_mode"])
    op.execute(
        sa.text(
            "CREATE UNIQUE INDEX uq_agents_agents_default_per_org "
            "ON agents_agents (organization_id) "
            "WHERE is_default = true"
        )
    )

    op.create_table(
        "agents_sessions",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("agent_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=True),
        sa.Column("model_override", sa.String(100), nullable=True),
        sa.Column("total_input_tokens", sa.BigInteger(), nullable=False, server_default=_zero),
        sa.Column("total_output_tokens", sa.BigInteger(), nullable=False, server_default=_zero),
        sa.Column("message_count", sa.Integer(), nullable=False, server_default=_zero),
        sa.Column("last_model_used", sa.String(100), nullable=True),
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=_false),
        sa.Column("created_at", _tz, nullable=False, server_default=_now),
        sa.Column("updated_at", _tz, nullable=False, server_default=_now),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(
            ["agent_id"], ["agents_agents.id"], name="fk_agents_sessions_agent_id"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"]),
    )
    op.create_index("ix_agents_sessions_org_id", "agents_sessions", ["organization_id"])
    op.create_index("ix_agents_sessions_agent_id", "agents_sessions", ["agent_id"])
    op.create_index("ix_agents_sessions_user_id", "agents_sessions", ["user_id"])

    op.create_table(
        "agents_messages",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default=_zero),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default=_zero),
        sa.Column("model", sa.String(100), nullable=True),
        sa.Column("tool_name", sa.String(100), nullable=True),
        sa.Column("tool_call_id", sa.String(100), nullable=True),
        sa.Column("tool_args", sa.JSON(), nullable=True),
        sa.Column("tool_result", sa.Text(), nullable=True),
        sa.Column("file_ids", postgresql.JSONB(), nullable=True),
        sa.Column("is_thinking", sa.Boolean(), nullable=False, server_default=_false),
        sa.Column("is_compacted", sa.Boolean(), nullable=False, server_default=_false),
        sa.Column("created_at", _tz, nullable=False, server_default=_now),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["session_id"], ["agents_sessions.id"]),
    )
    op.create_index(
        "ix_agents_messages_session_created",
        "agents_messages",
        ["session_id", "created_at"],
    )

    op.create_table(
        "agents_skills",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("owner_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("always_active", sa.Boolean(), nullable=False, server_default=_false),
        sa.Column("created_at", _tz, nullable=False, server_default=_now),
        sa.Column("updated_at", _tz, nullable=False, server_default=_now),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["login_users.id"], name="fk_agents_skills_owner_id"
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

    op.create_table(
        "agents_cron_tasks",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("agent_id", sa.Uuid(), nullable=False),
        sa.Column("execution_user_id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("cron_expression", sa.String(100), nullable=False),
        sa.Column("timezone", sa.String(100), nullable=False, server_default="UTC"),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=_true),
        sa.Column("last_run_at", _tz, nullable=True),
        sa.Column("next_run_at", _tz, nullable=True),
        sa.Column("last_run_status", sa.String(20), nullable=True),
        sa.Column("last_run_error", sa.Text(), nullable=True),
        sa.Column("run_count", sa.Integer(), nullable=False, server_default=_zero),
        sa.Column(
            "consecutive_failures", sa.Integer(), nullable=False, server_default=_zero
        ),
        sa.Column(
            "max_consecutive_failures", sa.Integer(), nullable=False, server_default=sa.text("3")
        ),
        sa.Column(
            "access_mode", _access_mode_enum, nullable=False, server_default="OWNER_ONLY"
        ),
        sa.Column("baseline_role", _content_role_enum, nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=_false),
        sa.Column("deleted_at", _tz, nullable=True),
        sa.Column("created_at", _tz, nullable=False, server_default=_now),
        sa.Column("updated_at", _tz, nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["owner_id"], ["login_users.id"]),
        sa.ForeignKeyConstraint(["agent_id"], ["agents_agents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["execution_user_id"], ["login_users.id"]),
        sa.ForeignKeyConstraint(
            ["session_id"], ["agents_sessions.id"], ondelete="SET NULL"
        ),
    )
    op.create_index("ix_agents_cron_tasks_org_id", "agents_cron_tasks", ["organization_id"])
    op.create_index("ix_agents_cron_tasks_owner_id", "agents_cron_tasks", ["owner_id"])
    op.create_index("ix_agents_cron_tasks_agent_id", "agents_cron_tasks", ["agent_id"])
    op.create_index(
        "ix_agents_cron_tasks_execution_user_id",
        "agents_cron_tasks",
        ["execution_user_id"],
    )
    op.create_index(
        "ix_agents_cron_tasks_access_mode", "agents_cron_tasks", ["access_mode"]
    )
    op.execute(
        sa.text(
            "CREATE INDEX ix_agents_cron_tasks_due "
            "ON agents_cron_tasks (organization_id, next_run_at) "
            "WHERE is_enabled = true AND is_deleted = false"
        )
    )

    op.create_table(
        "agents_run_logs",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("session_id", sa.Uuid(), nullable=True),
        sa.Column("channel_id", sa.Uuid(), nullable=True),
        sa.Column("agent_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column("provider_key_id", sa.Uuid(), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default=_zero),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default=_zero),
        sa.Column("tool_calls", sa.JSON(), nullable=True),
        sa.Column("tool_iterations", sa.Integer(), nullable=False, server_default=_zero),
        sa.Column("duration_ms", sa.Integer(), nullable=False, server_default=_zero),
        sa.Column("status", sa.String(20), nullable=False, server_default="success"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", _tz, nullable=False, server_default=_now),
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
    op.execute(
        sa.text(
            "CREATE INDEX ix_agents_run_logs_channel_created "
            "ON agents_run_logs (channel_id, created_at) "
            "WHERE channel_id IS NOT NULL"
        )
    )

    op.create_table(
        "agents_cron_run_logs",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("cron_task_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("agent_run_log_id", sa.Uuid(), nullable=True),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("result_summary", sa.Text(), nullable=True),
        sa.Column("started_at", _tz, nullable=False, server_default=_now),
        sa.Column("completed_at", _tz, nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default=_zero),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default=_zero),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["cron_task_id"], ["agents_cron_tasks.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["agent_run_log_id"], ["agents_run_logs.id"], ondelete="SET NULL"
        ),
    )
    op.create_index(
        "ix_agents_cron_run_logs_task_id", "agents_cron_run_logs", ["cron_task_id"]
    )
    op.create_index(
        "ix_agents_cron_run_logs_org_id", "agents_cron_run_logs", ["organization_id"]
    )
    op.create_index(
        "ix_agents_cron_run_logs_task_started",
        "agents_cron_run_logs",
        ["cron_task_id", "started_at"],
    )

    op.create_table(
        "agents_memories",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("agent_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("channel_id", sa.Uuid(), nullable=True),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.String(255), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("category", sa.String(50), nullable=False, server_default="facts"),
        sa.Column("importance", sa.Float(), nullable=False, server_default=sa.text("0.5")),
        sa.Column("access_count", sa.Integer(), nullable=False, server_default=_zero),
        sa.Column("created_at", _tz, nullable=False, server_default=_now),
        sa.Column("updated_at", _tz, nullable=False, server_default=_now),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["channel_id"], ["chat_channels.id"], ondelete="CASCADE"
        ),
        sa.CheckConstraint(
            "user_id IS NOT NULL OR channel_id IS NOT NULL",
            name="agents_memories_scope_present",
        ),
    )
    op.execute(
        sa.text(
            "ALTER TABLE agents_memories "
            "ADD CONSTRAINT uq_agents_memories_agent_user_channel_key "
            "UNIQUE NULLS NOT DISTINCT (agent_id, user_id, channel_id, key)"
        )
    )
    op.execute(
        sa.text(
            "CREATE INDEX ix_agents_memories_personal "
            "ON agents_memories (agent_id, user_id) "
            "WHERE user_id IS NOT NULL"
        )
    )
    op.execute(
        sa.text(
            "CREATE INDEX ix_agents_memories_channel "
            "ON agents_memories (agent_id, channel_id) "
            "WHERE channel_id IS NOT NULL"
        )
    )

    op.create_table(
        "agents_audit_logs",
        sa.Column("id", sa.Uuid(), nullable=False, server_default=sa.text("uuidv7()")),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("resource_type", sa.String(50), nullable=False),
        sa.Column("resource_id", sa.Uuid(), nullable=False),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.Column("created_at", _tz, nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_agents_audit_logs_org_created",
        "agents_audit_logs",
        ["organization_id", "created_at"],
    )
    op.create_index(
        "ix_agents_audit_logs_user_created",
        "agents_audit_logs",
        ["user_id", "created_at"],
    )

    op.create_table(
        "agents_approval_audit",
        sa.Column("request_id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "channel_id",
            sa.Uuid(),
            sa.ForeignKey("chat_channels.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("message_id", sa.Uuid(), nullable=False),
        sa.Column(
            "agent_id",
            sa.Uuid(),
            sa.ForeignKey("agents_agents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tool_name", sa.Text(), nullable=False),
        sa.Column("args_json", postgresql.JSONB(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column(
            "decided_by",
            sa.Uuid(),
            sa.ForeignKey("login_users.id"),
            nullable=True,
        ),
        sa.Column("decided_at", _tz, nullable=True),
        sa.Column("requested_at", _tz, nullable=False, server_default=_now),
        sa.Column("expires_at", _tz, nullable=False),
    )
    op.create_index(
        "ix_agents_approval_audit_channel",
        "agents_approval_audit",
        ["channel_id", sa.text("requested_at DESC")],
    )

    op.create_table(
        "agents_channel_bindings",
        sa.Column(
            "id", sa.Uuid(), primary_key=True, nullable=False, server_default=sa.text("uuidv7()")
        ),
        sa.Column(
            "channel_id",
            sa.Uuid(),
            sa.ForeignKey("chat_channels.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "agent_id",
            sa.Uuid(),
            sa.ForeignKey("agents_agents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("model_override", sa.Text(), nullable=True),
        sa.Column("tool_allowlist", postgresql.JSONB(), nullable=True),
        sa.Column("system_prompt_addendum", sa.Text(), nullable=True),
        sa.Column("respond_on_reply", sa.Boolean(), nullable=False, server_default=_true),
        sa.Column("respond_in_thread", sa.Boolean(), nullable=False, server_default=_true),
        sa.Column("context_radius", sa.Integer(), nullable=False, server_default=sa.text("8")),
        sa.Column(
            "rate_limit_per_minute", sa.Integer(), nullable=False, server_default=sa.text("10")
        ),
        sa.Column("token_budget_month", sa.Integer(), nullable=True),
        sa.Column("tokens_used_month", sa.Integer(), nullable=False, server_default=_zero),
        sa.Column("tokens_reset_at", _tz, nullable=True),
        sa.Column("last_compacted_at", _tz, nullable=True),
        sa.Column(
            "compaction_summary_msg_ids",
            postgresql.ARRAY(sa.Uuid()),
            nullable=False,
            server_default=sa.text("'{}'::uuid[]"),
        ),
        sa.Column(
            "last_active_token_estimate", sa.Integer(), nullable=False, server_default=_zero
        ),
        sa.Column("manual_reset_at", _tz, nullable=True),
        sa.Column(
            "created_by_user_id",
            sa.Uuid(),
            sa.ForeignKey("login_users.id"),
            nullable=False,
        ),
        sa.Column("created_at", _tz, nullable=False, server_default=_now),
        sa.Column("updated_at", _tz, nullable=False, server_default=_now),
        sa.UniqueConstraint("channel_id", "agent_id", name="agents_channel_bindings_unique"),
        sa.CheckConstraint(
            "context_radius BETWEEN 0 AND 50",
            name="agents_channel_bindings_context_radius_sane",
        ),
        sa.CheckConstraint(
            "rate_limit_per_minute BETWEEN 1 AND 1000",
            name="agents_channel_bindings_rate_sane",
        ),
    )
    op.create_index(
        "ix_agents_channel_bindings_agent",
        "agents_channel_bindings",
        ["agent_id"],
    )
    op.execute(
        sa.text(
            "ALTER TABLE agents_channel_bindings SET ("
            "fillfactor = 80, "
            "autovacuum_vacuum_scale_factor = 0.02, "
            "autovacuum_analyze_scale_factor = 0.05"
            ")"
        )
    )


def downgrade() -> None:
    """Drop agents domain tables."""
    op.drop_table("agents_channel_bindings")
    op.drop_table("agents_approval_audit")
    op.drop_table("agents_audit_logs")
    op.drop_table("agents_memories")
    op.drop_table("agents_cron_run_logs")
    op.drop_table("agents_run_logs")
    op.drop_table("agents_cron_tasks")
    op.drop_table("agents_skills")
    op.drop_table("agents_messages")
    op.drop_table("agents_sessions")
    op.execute("DROP INDEX IF EXISTS uq_agents_agents_default_per_org")
    op.drop_table("agents_agents")
    op.drop_table("agents_prompts")
    op.drop_table("agents_provider_keys")
