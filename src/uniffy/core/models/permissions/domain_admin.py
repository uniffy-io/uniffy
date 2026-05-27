"""Domain admin model for domain-scoped elevated access."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlmodel import Field, SQLModel

from uniffy.core.models.shared import DomainType
from uniffy.core.types import generate_id


class DomainAdmin(SQLModel, table=True):
    """Grants a user admin-level access within one domain (chat, files, etc.) of an org.

    Binary: row exists or it does not. Sits between regular member and org ADMIN/OWNER.
    """

    __tablename__ = "permissions_domain_admins"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "organization_id",
            "domain",
            name="uq_domain_admin_user_org_domain",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    organization_id: UUID = Field(
        foreign_key="login_organizations.id",
        nullable=False,
        index=True,
    )
    domain: DomainType = Field(
        sa_column=Column(
            SAEnum(DomainType, name="domaintype", create_type=False),
            nullable=False,
        ),
    )
    granted_by: UUID = Field(foreign_key="login_users.id", nullable=False)
    granted_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
