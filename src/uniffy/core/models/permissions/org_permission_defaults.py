"""Organization permission defaults model for default content permissions."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import Column, DateTime, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.models.shared import ContentType, VisibilityScope


class OrganizationPermissionDefaults(SQLModel, table=True):
    """
    Default permission settings for content types within an organization.

    Defines default visibility and member permissions for new content
    of each type created in an organization. Organization OWNER/ADMIN
    roles always have full access regardless of these settings - that
    behavior is hardcoded in PermissionChecker.

    Attributes
    ----------
    id : UUID
        Unique identifier for this defaults record (primary key).
    organization_id : UUID
        Organization these defaults apply to (foreign key).
    content_type : ContentType
        The type of content these defaults apply to.
    default_visibility : VisibilityScope
        Default visibility for newly created content of this type.
    members_can_view : bool
        Whether org members can view org-visibility content by default.
    members_can_edit : bool
        Whether org members can edit org-visibility content by default.
    members_can_delete : bool
        Whether org members can delete org-visibility content by default.
    members_can_share : bool
        Whether org members can share org-visibility content by default.
    updated_by_user_id : UUID
        User who last updated these defaults (foreign key).
    updated_at : datetime
        Timestamp when these defaults were last updated.

    Notes
    -----
    - One record per (organization_id, content_type) combination.
    - These defaults apply only to content with ORGANIZATION visibility.
    - Org OWNER/ADMIN always have full access regardless of these settings.

    """

    __tablename__ = "permissions_org_defaults"
    __table_args__ = (
        UniqueConstraint("organization_id", "content_type", name="uq_org_content_type"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    content_type: ContentType = Field(nullable=False)
    default_visibility: VisibilityScope = Field(default=VisibilityScope.PRIVATE, nullable=False)
    members_can_view: bool = Field(default=True, nullable=False)
    members_can_edit: bool = Field(default=False, nullable=False)
    members_can_delete: bool = Field(default=False, nullable=False)
    members_can_share: bool = Field(default=False, nullable=False)
    updated_by_user_id: UUID = Field(foreign_key="login_users.id", nullable=False)
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )

    def __repr__(self) -> str:
        """Return string representation of OrganizationPermissionDefaults."""
        return (
            f"<OrganizationPermissionDefaults(org={self.organization_id}, "
            f"type={self.content_type}, visibility={self.default_visibility})>"
        )
