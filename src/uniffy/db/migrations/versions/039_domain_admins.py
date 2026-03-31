"""Add permissions_domain_admins table for domain-scoped elevated access.

Revision ID: 039
Revises: 038
Create Date: 2026-03-30

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "039"
down_revision: str = "038"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_domaintype_enum = postgresql.ENUM(
    "CHAT",
    "FILES",
    "NOTES",
    "CALENDAR",
    "PROJECTS",
    "AGENTS",
    name="domaintype",
    create_type=False,
)


def upgrade() -> None:
    """Create permissions_domain_admins table."""
    postgresql.ENUM(
        "CHAT",
        "FILES",
        "NOTES",
        "CALENDAR",
        "PROJECTS",
        "AGENTS",
        name="domaintype",
    ).create(op.get_bind(), checkfirst=True)

    op.create_table(
        "permissions_domain_admins",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("domain", _domaintype_enum, nullable=False),
        sa.Column("granted_by", sa.Uuid(), nullable=False),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["login_users.id"]),
        sa.ForeignKeyConstraint(["organization_id"], ["login_organizations.id"]),
        sa.ForeignKeyConstraint(["granted_by"], ["login_users.id"]),
        sa.UniqueConstraint(
            "user_id",
            "organization_id",
            "domain",
            name="uq_domain_admin_user_org_domain",
        ),
    )

    op.create_index(
        "ix_domain_admins_user",
        "permissions_domain_admins",
        ["user_id"],
    )
    op.create_index(
        "ix_domain_admins_org",
        "permissions_domain_admins",
        ["organization_id"],
    )
    op.create_index(
        "ix_domain_admins_user_org_domain",
        "permissions_domain_admins",
        ["user_id", "organization_id", "domain"],
    )


def downgrade() -> None:
    """Drop permissions_domain_admins table."""
    op.drop_index(
        "ix_domain_admins_user_org_domain",
        table_name="permissions_domain_admins",
    )
    op.drop_index(
        "ix_domain_admins_org",
        table_name="permissions_domain_admins",
    )
    op.drop_index(
        "ix_domain_admins_user",
        table_name="permissions_domain_admins",
    )
    op.drop_table("permissions_domain_admins")
    postgresql.ENUM(name="domaintype").drop(op.get_bind(), checkfirst=True)
