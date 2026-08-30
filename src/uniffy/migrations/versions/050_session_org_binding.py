"""Bind UserSession to organization so refresh stays in the right tenant.

Revision ID: 050
Revises: 049
Create Date: 2026-05-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "050"
down_revision: str | None = "049"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "login_user_sessions",
        sa.Column("organization_id", sa.UUID(), nullable=True),
    )
    op.create_foreign_key(
        "fk_login_user_sessions_organization_id",
        "login_user_sessions",
        "login_organizations",
        ["organization_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_login_user_sessions_org_id",
        "login_user_sessions",
        ["organization_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_login_user_sessions_org_id", table_name="login_user_sessions")
    op.drop_constraint(
        "fk_login_user_sessions_organization_id",
        "login_user_sessions",
        type_="foreignkey",
    )
    op.drop_column("login_user_sessions", "organization_id")
