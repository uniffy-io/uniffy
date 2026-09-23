"""Add the participant auth session link and the organization call end reasons."""

import sqlalchemy as sa
from alembic import op

revision: str = "105"
down_revision: str | None = "104"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "calls_participants",
        sa.Column("auth_session_id", sa.Uuid(), nullable=True),
    )
    op.create_index(
        "ix_calls_participants_auth_session_id",
        "calls_participants",
        ["auth_session_id"],
    )
    op.create_foreign_key(
        "calls_participants_auth_session_id_fkey",
        "calls_participants",
        "login_user_sessions",
        ["auth_session_id"],
        ["id"],
        ondelete="SET NULL",
    )
    # Legal inside the migration transaction because no statement here uses the
    # new labels; PostgreSQL only forbids reading a label added in the same
    # transaction.
    op.execute("ALTER TYPE callendreason ADD VALUE IF NOT EXISTS 'ORG_SUSPENDED'")
    op.execute("ALTER TYPE callendreason ADD VALUE IF NOT EXISTS 'ORG_DELETED'")


def downgrade() -> None:
    op.drop_constraint(
        "calls_participants_auth_session_id_fkey", "calls_participants", type_="foreignkey"
    )
    op.drop_index("ix_calls_participants_auth_session_id", table_name="calls_participants")
    op.drop_column("calls_participants", "auth_session_id")
    # PostgreSQL cannot drop an enum label; the organization reasons stay on callendreason.
