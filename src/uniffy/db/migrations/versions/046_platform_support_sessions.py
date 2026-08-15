"""Time-bound platform support sessions.

Revision ID: 046
Revises: 045
Create Date: 2026-05-25

Creates ``platform_support_sessions`` plus the two enums backing the
session ``scope`` and ``state`` columns. v1 only ships READ_ONLY
scope, but both enum values are created up front so the READ_WRITE
follow-up does not need a second migration.

Index choices:

* ``ix_platform_support_sessions_active_user_org``
  (``support_user_id``, ``organization_id``) WHERE state = 'ACTIVE'
  -- the PermissionChecker hot lookup. Partial so the index stays
  small for the long tail of EXPIRED / REVOKED rows.
* ``ix_platform_support_sessions_expires_at`` -- the ARQ expiry
  sweep reads ``state='ACTIVE' AND expires_at <= now()``.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "046"
down_revision: str | Sequence[str] | None = "045"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_scope_enum = postgresql.ENUM(
    "READ_ONLY",
    "READ_WRITE",
    name="supportsessionscope",
    create_type=False,
)
_state_enum = postgresql.ENUM(
    "PENDING",
    "ACTIVE",
    "EXPIRED",
    "REVOKED",
    "REJECTED",
    name="supportsessionstate",
    create_type=False,
)


def upgrade() -> None:
    """Create the support session table + supporting enums + indexes."""
    postgresql.ENUM(
        "READ_ONLY",
        "READ_WRITE",
        name="supportsessionscope",
    ).create(op.get_bind(), checkfirst=True)
    postgresql.ENUM(
        "PENDING",
        "ACTIVE",
        "EXPIRED",
        "REVOKED",
        "REJECTED",
        name="supportsessionstate",
    ).create(op.get_bind(), checkfirst=True)

    op.create_table(
        "platform_support_sessions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "organization_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("login_organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "support_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("login_users.id"),
            nullable=False,
        ),
        sa.Column(
            "requested_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("login_users.id"),
            nullable=False,
        ),
        sa.Column(
            "granted_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("login_users.id"),
            nullable=True,
        ),
        sa.Column(
            "revoked_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("login_users.id"),
            nullable=True,
        ),
        sa.Column("reason", sa.String(length=2000), nullable=False),
        sa.Column("scope", _scope_enum, nullable=False),
        sa.Column("state", _state_enum, nullable=False),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_index(
        "ix_platform_support_sessions_organization_id",
        "platform_support_sessions",
        ["organization_id"],
    )
    op.create_index(
        "ix_platform_support_sessions_support_user_id",
        "platform_support_sessions",
        ["support_user_id"],
    )
    op.create_index(
        "ix_platform_support_sessions_state",
        "platform_support_sessions",
        ["state"],
    )
    op.create_index(
        "ix_platform_support_sessions_expires_at",
        "platform_support_sessions",
        ["expires_at"],
    )
    op.execute(
        "CREATE INDEX ix_platform_support_sessions_active_user_org "
        "ON platform_support_sessions (support_user_id, organization_id) "
        "WHERE state = 'ACTIVE'"
    )


def downgrade() -> None:
    """Drop the table + the two enum types."""
    op.execute("DROP INDEX IF EXISTS ix_platform_support_sessions_active_user_org")
    op.drop_index(
        "ix_platform_support_sessions_expires_at",
        table_name="platform_support_sessions",
    )
    op.drop_index(
        "ix_platform_support_sessions_state",
        table_name="platform_support_sessions",
    )
    op.drop_index(
        "ix_platform_support_sessions_support_user_id",
        table_name="platform_support_sessions",
    )
    op.drop_index(
        "ix_platform_support_sessions_organization_id",
        table_name="platform_support_sessions",
    )
    op.drop_table("platform_support_sessions")
    op.execute("DROP TYPE IF EXISTS supportsessionstate")
    op.execute("DROP TYPE IF EXISTS supportsessionscope")
