"""Per-org defaults seeded onto new content; not an ongoing ceiling."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.models.shared import AccessMode, ContentRole, ContentType
from uniffy.core.types import generate_id


class OrganizationPermissionDefaults(SQLModel, table=True):
    """Default `access_mode` + `baseline_role` applied when new content is created.

    `default_baseline_role` MUST be NULL unless `default_access_mode == OPEN_TO_ORG`,
    and must never be `OWNER` or `BLOCKED` (not valid baselines).
    """

    __tablename__ = "permissions_org_defaults"
    __table_args__ = (
        UniqueConstraint("organization_id", "content_type", name="uq_org_content_type"),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    content_type: ContentType = Field(nullable=False)
    default_access_mode: AccessMode = Field(nullable=False)
    default_baseline_role: ContentRole | None = Field(default=None)
    updated_by_user_id: UUID = Field(foreign_key="login_users.id", nullable=False)
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )

    def __repr__(self) -> str:
        return (
            f"<OrganizationPermissionDefaults(org={self.organization_id}, "
            f"type={self.content_type}, mode={self.default_access_mode}, "
            f"baseline={self.default_baseline_role})>"
        )
