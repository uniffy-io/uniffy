"""Skill versioning, drafts, usage attribution, and message feedback.

Revision ID: 052
Revises: 051
Create Date: 2026-06-20

Extends ``agents_skills`` with progressive-disclosure metadata
(``when_to_use`` / ``requires_tools`` / ``requires_context``), provenance
(``origin`` / ``created_by_agent_id``), and the main-version pointer
(``latest_version_number`` / ``active_version_id`` / ``active_version_pinned``).
Adds four tables: immutable ``agents_skill_versions``, the
``agents_skill_drafts`` review queue, ``agents_skill_usages`` attribution
rows, and ``agents_message_feedback`` thumbs ratings.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "052"
down_revision: str | None = "051"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "agents_skills",
        sa.Column("when_to_use", sa.Text(), nullable=False, server_default=sa.text("''")),
    )
    op.add_column(
        "agents_skills",
        sa.Column(
            "requires_tools",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column(
        "agents_skills",
        sa.Column(
            "requires_context",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.add_column(
        "agents_skills",
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'active'"),
        ),
    )
    op.add_column(
        "agents_skills",
        sa.Column(
            "origin",
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'user'"),
        ),
    )
    op.add_column(
        "agents_skills",
        sa.Column("created_by_agent_id", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "agents_skills",
        sa.Column(
            "latest_version_number",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1"),
        ),
    )
    op.add_column(
        "agents_skills",
        sa.Column("active_version_id", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "agents_skills",
        sa.Column(
            "active_version_pinned",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )

    op.create_table(
        "agents_skill_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("skill_id", sa.Uuid(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("content", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("when_to_use", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column(
            "requires_tools",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "requires_context",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("author_id", sa.Uuid(), nullable=True),
        sa.Column(
            "author_kind",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'user'"),
        ),
        sa.Column("change_summary", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("parent_version_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["skill_id"], ["agents_skills.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "skill_id",
            "version_number",
            name="uq_agents_skill_versions_skill_version",
        ),
    )

    op.create_table(
        "agents_skill_drafts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("target_skill_id", sa.Uuid(), nullable=True),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("proposed_by_agent_id", sa.Uuid(), nullable=True),
        sa.Column("session_id", sa.Uuid(), nullable=True),
        sa.Column("channel_id", sa.Uuid(), nullable=True),
        sa.Column("origin_chat_message_id", sa.Uuid(), nullable=True),
        sa.Column(
            "evidence_message_ids",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("rationale", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("name", sa.String(length=100), nullable=True),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("description", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("content", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("when_to_use", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column(
            "requires_tools",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "requires_context",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "suggested_scope",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'personal'"),
        ),
        sa.Column(
            "suggested_always_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["owner_id"], ["login_users.id"]),
    )
    op.create_index(
        "ix_agents_skill_drafts_org_status",
        "agents_skill_drafts",
        ["organization_id", "status"],
    )
    op.create_index(
        "ix_agents_skill_drafts_owner_status",
        "agents_skill_drafts",
        ["owner_id", "status"],
    )
    op.create_index(
        "ix_agents_skill_drafts_target_skill",
        "agents_skill_drafts",
        ["target_skill_id"],
    )
    op.create_index(
        "ix_agents_skill_drafts_channel",
        "agents_skill_drafts",
        ["channel_id"],
    )

    op.create_table(
        "agents_skill_usages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_log_id", sa.Uuid(), nullable=True),
        sa.Column("session_id", sa.Uuid(), nullable=True),
        sa.Column("skill_id", sa.Uuid(), nullable=False),
        sa.Column("skill_version", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("agent_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("injected", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("viewed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("invoked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_agents_skill_usages_skill_created",
        "agents_skill_usages",
        ["skill_id", "created_at"],
    )
    op.create_index(
        "ix_agents_skill_usages_session",
        "agents_skill_usages",
        ["session_id"],
    )

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


def downgrade() -> None:
    op.drop_table("agents_message_feedback")
    op.drop_index("ix_agents_skill_usages_session", table_name="agents_skill_usages")
    op.drop_index("ix_agents_skill_usages_skill_created", table_name="agents_skill_usages")
    op.drop_table("agents_skill_usages")
    op.drop_index("ix_agents_skill_drafts_channel", table_name="agents_skill_drafts")
    op.drop_index("ix_agents_skill_drafts_target_skill", table_name="agents_skill_drafts")
    op.drop_index("ix_agents_skill_drafts_owner_status", table_name="agents_skill_drafts")
    op.drop_index("ix_agents_skill_drafts_org_status", table_name="agents_skill_drafts")
    op.drop_table("agents_skill_drafts")
    op.drop_table("agents_skill_versions")
    op.drop_column("agents_skills", "active_version_pinned")
    op.drop_column("agents_skills", "active_version_id")
    op.drop_column("agents_skills", "latest_version_number")
    op.drop_column("agents_skills", "created_by_agent_id")
    op.drop_column("agents_skills", "origin")
    op.drop_column("agents_skills", "status")
    op.drop_column("agents_skills", "requires_context")
    op.drop_column("agents_skills", "requires_tools")
    op.drop_column("agents_skills", "when_to_use")
