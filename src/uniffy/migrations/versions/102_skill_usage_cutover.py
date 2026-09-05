"""Drop ambiguous skill usage observations and passive analysis configuration."""

from alembic import op
import sqlalchemy as sa

revision = "102"
down_revision = "101"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("agents_skill_usages")
    op.execute(
        sa.text(
            "DELETE FROM org_settings WHERE namespace = 'agents' AND key = 'skill_evolution_enabled'"
        )
    )


def downgrade() -> None:
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
