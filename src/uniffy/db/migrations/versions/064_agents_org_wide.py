"""Agents domain end state: audience-scoped memories (user/channel/session/org)
with pin and source tiers plus personal-memory bridge opt-ins, the prompts table
and agents.prompt_id gone, cron run history folded into agents_run_logs,
test-drawer sessions, message feedback covering both session and chat replies,
and org-wide-only provider keys and skills (no credential_type, no per-key
access policy, no personal owner, no draft scope).

Revision ID: 064
Revises: 063
Create Date: 2026-07-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "064"
down_revision: str | None = "063"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_access_mode_enum = postgresql.ENUM(
    "OWNER_ONLY",
    "EXPLICIT_MEMBERS",
    "OPEN_TO_ORG",
    name="accessmode",
    create_type=False,
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

_SCOPE_CHECK = (
    "(scope = 'user' AND user_id IS NOT NULL AND channel_id IS NULL AND session_id IS NULL)"
    " OR (scope = 'channel' AND channel_id IS NOT NULL AND user_id IS NULL AND session_id IS NULL)"
    " OR (scope = 'session' AND session_id IS NOT NULL AND user_id IS NULL AND channel_id IS NULL)"
    " OR (scope = 'org' AND user_id IS NULL AND channel_id IS NULL AND session_id IS NULL)"
)


def upgrade() -> None:
    # scope, created_by_user_id and description land NOT NULL, but rows written
    # before this revision carry no value for them: add nullable, derive each
    # from the row's existing subject, then tighten. Adding them NOT NULL
    # outright only survives an empty table.
    op.add_column("agents_memories", sa.Column("scope", sa.String(20), nullable=True))
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

    # The pre-revision check only required user_id OR channel_id, so a row may
    # carry both; agents_memories_scope_consistent below demands exactly one.
    # A row with both resolves to 'user' - the narrower audience - because
    # promoting a personal memory to channel scope would widen who can read it.
    op.execute(
        sa.text(
            "UPDATE agents_memories SET scope = 'user', channel_id = NULL "
            "WHERE user_id IS NOT NULL"
        )
    )
    op.execute(
        sa.text(
            "UPDATE agents_memories SET scope = 'channel' "
            "WHERE user_id IS NULL AND channel_id IS NOT NULL"
        )
    )
    op.execute(
        sa.text(
            "UPDATE agents_memories m SET created_by_user_id = COALESCE("
            "m.user_id, (SELECT a.owner_id FROM agents_agents a WHERE a.id = m.agent_id)"
            ") WHERE m.created_by_user_id IS NULL"
        )
    )
    op.execute(sa.text("UPDATE agents_memories SET description = key WHERE description IS NULL"))

    op.alter_column("agents_memories", "scope", nullable=False)
    op.alter_column("agents_memories", "created_by_user_id", nullable=False)
    op.alter_column("agents_memories", "description", nullable=False)
    op.add_column(
        "agents_memories",
        sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "agents_memories",
        sa.Column("source", sa.String(10), nullable=False, server_default="tool"),
    )

    op.drop_constraint("agents_memories_scope_present", "agents_memories", type_="check")
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

    op.create_table(
        "agents_memory_bridge_optins",
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("login_users.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "organization_id",
            UUID(as_uuid=True),
            sa.ForeignKey("login_organizations.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.drop_index("ix_agents_agents_prompt_id", table_name="agents_agents")
    op.drop_column("agents_agents", "prompt_id")
    op.drop_table("agents_prompts")

    op.add_column(
        "agents_run_logs",
        sa.Column(
            "cron_task_id",
            UUID(as_uuid=True),
            sa.ForeignKey(
                "agents_cron_tasks.id",
                ondelete="SET NULL",
                name="fk_agents_run_logs_cron_task_id",
            ),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_agents_run_logs_cron_task_created",
        "agents_run_logs",
        ["cron_task_id", "created_at"],
    )
    op.drop_table("agents_cron_run_logs")

    op.drop_column("agents_sessions", "model_params_override")
    op.add_column(
        "agents_sessions",
        sa.Column("is_test", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    op.drop_table("agents_message_feedback")
    op.create_table(
        "agents_message_feedback",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "agents_message_id",
            UUID(as_uuid=True),
            sa.ForeignKey("agents_messages.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "chat_message_id",
            UUID(as_uuid=True),
            sa.ForeignKey("chat_messages.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("login_users.id"),
            nullable=False,
        ),
        sa.Column("rating", sa.String(8), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(agents_message_id IS NULL) != (chat_message_id IS NULL)",
            name="ck_agents_message_feedback_one_target",
        ),
    )
    op.create_index(
        "uq_agents_message_feedback_session",
        "agents_message_feedback",
        ["agents_message_id", "user_id"],
        unique=True,
        postgresql_where=sa.text("agents_message_id IS NOT NULL"),
    )
    op.create_index(
        "uq_agents_message_feedback_chat",
        "agents_message_feedback",
        ["chat_message_id", "user_id"],
        unique=True,
        postgresql_where=sa.text("chat_message_id IS NOT NULL"),
    )

    op.drop_column("agents_provider_keys", "credential_type")
    op.drop_column("agents_provider_keys", "access_mode")
    op.drop_column("agents_provider_keys", "baseline_role")

    op.drop_column("agents_skills", "owner_id")
    op.drop_column("agents_skill_drafts", "suggested_scope")


def downgrade() -> None:
    op.add_column(
        "agents_skill_drafts",
        sa.Column(
            "suggested_scope",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'personal'"),
        ),
    )
    op.add_column(
        "agents_skills",
        sa.Column(
            "owner_id",
            sa.Uuid(),
            sa.ForeignKey("login_users.id", name="fk_agents_skills_owner_id"),
            nullable=True,
        ),
    )
    op.create_index("ix_agents_skills_owner_id", "agents_skills", ["owner_id"])

    op.add_column(
        "agents_provider_keys",
        sa.Column("baseline_role", _content_role_enum, nullable=True),
    )
    op.add_column(
        "agents_provider_keys",
        sa.Column(
            "access_mode",
            _access_mode_enum,
            nullable=True,
            server_default="OWNER_ONLY",
        ),
    )
    op.add_column(
        "agents_provider_keys",
        sa.Column(
            "credential_type",
            sa.String(20),
            nullable=False,
            server_default="api_key",
        ),
    )

    op.drop_index("uq_agents_message_feedback_chat", table_name="agents_message_feedback")
    op.drop_index(
        "uq_agents_message_feedback_session", table_name="agents_message_feedback"
    )
    op.drop_table("agents_message_feedback")
    op.create_table(
        "agents_message_feedback",
        sa.Column("message_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("rating", sa.String(length=8), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("message_id", "user_id"),
        sa.ForeignKeyConstraint(["message_id"], ["agents_messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"]),
    )

    op.drop_column("agents_sessions", "is_test")
    op.add_column(
        "agents_sessions",
        sa.Column("model_params_override", JSONB(), nullable=True),
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
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default=sa.text("0")),
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
    op.drop_index("ix_agents_run_logs_cron_task_created", table_name="agents_run_logs")
    op.drop_column("agents_run_logs", "cron_task_id")

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
            "access_mode", _access_mode_enum, nullable=True, server_default="OPEN_TO_ORG"
        ),
        sa.Column("baseline_role", _content_role_enum, nullable=True, server_default="VIEWER"),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
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
    op.add_column(
        "agents_agents",
        sa.Column(
            "prompt_id",
            sa.Uuid(),
            sa.ForeignKey(
                "agents_prompts.id",
                ondelete="SET NULL",
                name="fk_agents_agents_prompt_id",
            ),
            nullable=True,
        ),
    )
    op.create_index("ix_agents_agents_prompt_id", "agents_agents", ["prompt_id"])

    op.drop_table("agents_memory_bridge_optins")

    op.drop_index("ix_agents_memories_org", table_name="agents_memories")
    op.drop_index("ix_agents_memories_session", table_name="agents_memories")
    op.drop_constraint("uq_agents_memories_scope_key", "agents_memories", type_="unique")
    op.execute(
        sa.text(
            "ALTER TABLE agents_memories "
            "ADD CONSTRAINT uq_agents_memories_agent_user_channel_key "
            "UNIQUE NULLS NOT DISTINCT (agent_id, user_id, channel_id, key)"
        )
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
    op.drop_column("agents_memories", "source")
    op.drop_column("agents_memories", "pinned")
    op.drop_column("agents_memories", "description")
    op.drop_column("agents_memories", "created_by_user_id")
    op.drop_column("agents_memories", "session_id")
    op.drop_column("agents_memories", "scope")
