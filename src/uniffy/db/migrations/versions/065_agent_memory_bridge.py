"""Per-user opt-in: use personal agent memory in shared spaces (read-only bridge).

Revision ID: 065
Revises: 064
Create Date: 2026-07-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "065"
down_revision: str | None = "064"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
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


def downgrade() -> None:
    op.drop_table("agents_memory_bridge_optins")
