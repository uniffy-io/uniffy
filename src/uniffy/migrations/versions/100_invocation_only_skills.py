"""Remove automatic skill activation and restrict supported conversation surfaces."""

import sqlalchemy as sa
from alembic import op

revision = "100"
down_revision = "099"
branch_labels = None
depends_on = None

_TABLES = ("agents_skills", "agents_skill_versions", "agents_skill_drafts")


def upgrade() -> None:
    for table in _TABLES:
        op.alter_column(table, "requires_context", new_column_name="supported_surfaces")
        op.create_check_constraint(
            f"ck_{table}_supported_surfaces",
            table,
            "jsonb_typeof(supported_surfaces) = 'array' "
            """AND supported_surfaces <@ '["session", "chat"]'::jsonb""",
        )
        op.drop_column(table, "when_to_use")
    op.drop_column("agents_skills", "always_active")
    op.drop_column("agents_skill_drafts", "suggested_always_active")


def downgrade() -> None:
    for table in _TABLES:
        op.drop_constraint(f"ck_{table}_supported_surfaces", table, type_="check")
        op.alter_column(table, "supported_surfaces", new_column_name="requires_context")
        op.add_column(table, sa.Column("when_to_use", sa.Text(), nullable=False, server_default=""))
    # Removed activation and routing values cannot be reconstructed.
    op.add_column(
        "agents_skills",
        sa.Column("always_active", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "agents_skill_drafts",
        sa.Column("suggested_always_active", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
