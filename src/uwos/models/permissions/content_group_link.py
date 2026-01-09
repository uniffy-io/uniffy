"""Content-Group association model."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel

from uwos.models.shared import ContentType


class ContentGroupLink(SQLModel, table=True):
    """
    Link table between content items and groups.

    Associates any content type with one or more groups, enabling content
    to be shared within group spaces. Multiple links allow content to appear
    in multiple group spaces simultaneously.

    Attributes
    ----------
    id : UUID
        Unique identifier for the link (primary key).
    organization_id : UUID
        Organization this link belongs to (foreign key).
    content_type : ContentType
        Type of content being linked (note, file, calendar_event, etc.).
    content_id : UUID
        ID of the content item being linked.
    group_id : UUID
        Group this content is associated with (foreign key).
    linked_by_user_id : UUID
        User who created this link (foreign key).
    linked_at : datetime
        Timestamp when the link was created.
    updated_at : datetime
        Timestamp when the link was last updated.

    """

    __tablename__ = "permissions_content_group_links"

    id: UUID = Field(default_factory=uuid4, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    content_type: ContentType = Field(nullable=False, index=True)
    content_id: UUID = Field(nullable=False, index=True)
    group_id: UUID = Field(foreign_key="login_groups.id", nullable=False, index=True)
    linked_by_user_id: UUID = Field(foreign_key="login_users.id", nullable=False)
    linked_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )

    def __repr__(self) -> str:
        """Return string representation of ContentGroupLink."""
        return (
            f"<ContentGroupLink(content_type={self.content_type}, "
            f"content_id={self.content_id}, group_id={self.group_id})>"
        )
