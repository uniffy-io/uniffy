"""Content permission model for granular access control."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel

from uniffy.core.models.shared import ContentType, PermissionLevel, SubjectType


class ContentPermission(SQLModel, table=True):
    """
    Granular permission model for any content type.

    Provides fine-grained access control for content items. Can grant
    permissions to individual users, groups, or entire organizations.
    Supports both coarse-grained (permission_level) and fine-grained
    (individual action flags) access control.

    Attributes
    ----------
    id : UUID
        Unique identifier for the permission (primary key).
    organization_id : UUID
        Organization this permission belongs to (foreign key).
    content_type : ContentType
        Type of content this permission applies to.
    content_id : UUID
        ID of the content item.
    subject_type : SubjectType
        Type of subject (user, group, or organization).
    subject_id : UUID
        ID of the user, group, or organization.
    permission_level : PermissionLevel
        Overall permission level (VIEW, EDIT, ADMIN, OWNER).
    can_view : bool
        Fine-grained: Can view the content.
    can_edit : bool
        Fine-grained: Can edit the content.
    can_delete : bool
        Fine-grained: Can delete the content.
    can_share : bool
        Fine-grained: Can share the content with others.
    can_move : bool
        Fine-grained: Can move content between spaces.
    granted_by_user_id : UUID
        User who granted this permission (foreign key).
    granted_at : datetime
        Timestamp when the permission was granted.
    updated_at : datetime
        Timestamp when the permission was last updated.
    expires_at : datetime | None
        Optional expiration timestamp for temporary access.

    """

    __tablename__ = "permissions_content_permissions"

    id: UUID = Field(default_factory=uuid4, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    content_type: ContentType = Field(nullable=False, index=True)
    content_id: UUID = Field(nullable=False, index=True)
    subject_type: SubjectType = Field(nullable=False, index=True)
    subject_id: UUID = Field(nullable=False, index=True)
    permission_level: PermissionLevel = Field(default=PermissionLevel.VIEW, nullable=False)
    can_view: bool = Field(default=True, nullable=False)
    can_edit: bool = Field(default=False, nullable=False)
    can_delete: bool = Field(default=False, nullable=False)
    can_share: bool = Field(default=False, nullable=False)
    can_move: bool = Field(default=False, nullable=False)
    granted_by_user_id: UUID = Field(foreign_key="login_users.id", nullable=False)
    granted_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )
    expires_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))

    def __repr__(self) -> str:
        """Return string representation of ContentPermission."""
        return (
            f"<ContentPermission(content_type={self.content_type}, "
            f"subject_type={self.subject_type}, level={self.permission_level})>"
        )
