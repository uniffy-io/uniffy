"""Add agent audit log table.

Revision ID: 032
Revises: 031
"""

import sqlalchemy as sa
from alembic import op

revision = "032"
down_revision = "031"


def upgrade() -> None:
    op.create_table(
        "agents_audit_logs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("resource_type", sa.String(50), nullable=False),
        sa.Column("resource_id", sa.Uuid(), nullable=False),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
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


def downgrade() -> None:
    op.drop_index("ix_agents_audit_logs_user_created", table_name="agents_audit_logs")
    op.drop_index("ix_agents_audit_logs_org_created", table_name="agents_audit_logs")
    op.drop_table("agents_audit_logs")
