"""Organization invitations.

Revision ID: 043
Revises: 042
Create Date: 2026-05-22

Adds ``login_invitations`` for invite-by-email org membership. Tokens are
stored as SHA256 hex digests; the raw token only exists in the invite
email. A partial unique index on ``(organization_id, email)`` filtered to
non-accepted, non-revoked rows blocks duplicate pending invites for the
same address. The ``organizationrole`` enum is reused -- no new types.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "043"
down_revision: str | None = "042"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_organization_role_enum = postgresql.ENUM(
    "MEMBER",
    "ADMIN",
    "OWNER",
    name="organizationrole",
    create_type=False,
)


def upgrade() -> None:
    """Create ``login_invitations`` + supporting indexes."""
    op.create_table(
        "login_invitations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("role", _organization_role_enum, nullable=False),
        sa.Column("invited_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("accepted_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by_user_id", sa.Uuid(), nullable=True),
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
        sa.UniqueConstraint("token_hash", name="uq_login_invitations_token_hash"),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["login_organizations.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["invited_by_user_id"],
            ["login_users.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["accepted_by_user_id"],
            ["login_users.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["revoked_by_user_id"],
            ["login_users.id"],
            ondelete="SET NULL",
        ),
    )
    op.create_index(
        "ix_login_invitations_organization_id",
        "login_invitations",
        ["organization_id"],
    )
    op.create_index(
        "ix_login_invitations_email",
        "login_invitations",
        ["email"],
    )
    op.create_index(
        "ix_login_invitations_token_hash",
        "login_invitations",
        ["token_hash"],
    )
    op.create_index(
        "ix_login_invitations_pending",
        "login_invitations",
        ["organization_id", "email"],
        unique=True,
        postgresql_where=sa.text("accepted_at IS NULL AND revoked_at IS NULL"),
    )


def downgrade() -> None:
    """Drop the invitations table and its indexes."""
    op.drop_index("ix_login_invitations_pending", table_name="login_invitations")
    op.drop_index("ix_login_invitations_token_hash", table_name="login_invitations")
    op.drop_index("ix_login_invitations_email", table_name="login_invitations")
    op.drop_index(
        "ix_login_invitations_organization_id",
        table_name="login_invitations",
    )
    op.drop_table("login_invitations")
