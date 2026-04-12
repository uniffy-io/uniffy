"""Organization permission defaults model for default content access.

Stores per-(organization, content_type) templates used when new content
of that type is created. The defaults determine what ``access_mode`` and
``baseline_role`` a new item gets on creation; they are templates, not
ongoing ceilings. A user can change an individual content item's access
policy freely after creation (subject to their permissions on that item).
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.models.shared import AccessMode, ContentRole, ContentType
from uniffy.core.types import generate_id


class OrganizationPermissionDefaults(SQLModel, table=True):
    """
    Default content access settings per content type within an organization.

    When a user creates a new content item of a given type, the backend
    reads these defaults and applies them to the new item's ``access_mode``
    and ``baseline_role`` columns. Org OWNER/ADMIN roles always have full
    access regardless of these settings; that behavior is hardcoded in
    :class:`PermissionChecker`.

    Attributes
    ----------
    id : UUID
        Unique identifier for this defaults record (primary key).
    organization_id : UUID
        Organization these defaults apply to (foreign key).
    content_type : ContentType
        Content type these defaults apply to.
    default_access_mode : AccessMode
        Default access mode for newly created content of this type.
    default_baseline_role : ContentRole | None
        Default baseline role for newly created content of this type.
        Must be NULL unless ``default_access_mode == OPEN_TO_ORG``. Must
        not be ``OWNER`` or ``BLOCKED`` (those are not valid baselines).
    updated_by_user_id : UUID
        User who last updated these defaults.
    updated_at : datetime
        When these defaults were last updated.

    Notes
    -----
    - One row per (organization_id, content_type) combination.
    - Org OWNER/ADMIN always bypass these defaults via the permission
      checker's top-level admin bypass.

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
        """Return string representation of OrganizationPermissionDefaults."""
        return (
            f"<OrganizationPermissionDefaults(org={self.organization_id}, "
            f"type={self.content_type}, mode={self.default_access_mode}, "
            f"baseline={self.default_baseline_role})>"
        )
