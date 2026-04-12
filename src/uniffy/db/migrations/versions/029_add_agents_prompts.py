"""Add agents_prompts table, prompt_id FK on agents_agents, and PROMPT content type.

Revision ID: 029
Revises: 028
Create Date: 2026-03-08

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "029"
down_revision: str = "028"
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


def upgrade() -> None:
    """Create agents_prompts table and add prompt_id to agents_agents."""

    op.create_table(
        "agents_prompts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("content", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=True),
        sa.Column(
            "access_mode",
            _access_mode_enum,
            nullable=False,
            server_default="OPEN_TO_ORG",
        ),
        sa.Column(
            "baseline_role",
            _content_role_enum,
            nullable=True,
            server_default="VIEWER",
        ),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["login_organizations.id"],
        ),
    )
    op.create_index("ix_agents_prompts_organization_id", "agents_prompts", ["organization_id"])
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

    # Add prompt_id FK to agents_agents
    op.add_column(
        "agents_agents",
        sa.Column("prompt_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_agents_agents_prompt_id",
        "agents_agents",
        "agents_prompts",
        ["prompt_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_agents_agents_prompt_id", "agents_agents", ["prompt_id"])


def downgrade() -> None:
    """Drop agents_prompts table and prompt_id from agents_agents."""
    op.drop_index("ix_agents_agents_prompt_id", table_name="agents_agents")
    op.drop_constraint("fk_agents_agents_prompt_id", "agents_agents", type_="foreignkey")
    op.drop_column("agents_agents", "prompt_id")

    op.drop_index("uq_agents_prompts_bundled_name", table_name="agents_prompts")
    op.drop_index("uq_agents_prompts_org_name", table_name="agents_prompts")
    op.drop_index("ix_agents_prompts_access_mode", table_name="agents_prompts")
    op.drop_index("ix_agents_prompts_organization_id", table_name="agents_prompts")
    op.drop_table("agents_prompts")
