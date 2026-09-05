"""Add versioned rules and explicit agent rule selections."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "098"
down_revision: str | None = "097"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agents_rules",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "organization_id", sa.Uuid(), sa.ForeignKey("login_organizations.id"), nullable=True
        ),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("latest_version_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("active_version_id", sa.Uuid(), nullable=True),
        sa.Column("active_version_pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(source = 'bundled' AND organization_id IS NULL) OR "
            "(source = 'organization' AND organization_id IS NOT NULL)",
            name="ck_agents_rules_source_scope",
        ),
        sa.CheckConstraint("status IN ('active', 'retired')", name="ck_agents_rules_status"),
    )
    op.create_index("ix_agents_rules_organization_id", "agents_rules", ["organization_id"])
    op.create_index("ix_agents_rules_active_version_id", "agents_rules", ["active_version_id"])
    op.create_index(
        "uq_agents_rules_org_name",
        "agents_rules",
        ["organization_id", "name"],
        unique=True,
        postgresql_where=sa.text("organization_id IS NOT NULL"),
    )
    op.create_index(
        "uq_agents_rules_bundled_name",
        "agents_rules",
        ["name"],
        unique=True,
        postgresql_where=sa.text("organization_id IS NULL"),
    )
    op.create_table(
        "agents_rule_versions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "rule_id",
            sa.Uuid(),
            sa.ForeignKey("agents_rules.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("author_id", sa.Uuid(), nullable=True),
        sa.Column("change_summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("parent_version_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("rule_id", "version_number", name="uq_agents_rule_versions_number"),
    )
    op.add_column(
        "agents_agents",
        sa.Column(
            "enabled_rules",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("agents_agents", "enabled_rules")
    op.drop_table("agents_rule_versions")
    op.drop_table("agents_rules")
