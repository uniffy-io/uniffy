"""Attachment model for linking files to content."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Index
from sqlalchemy import Enum as SAEnum
from sqlmodel import Field, SQLModel

from uniffy.core.models.shared import ContentType
from uniffy.core.types import generate_id


class Attachment(SQLModel, table=True):
    """
    Attachment model linking files to content.

    Each attachment represents a file attached to a piece of content (note, chat, etc.).
    Files are copied to the user's Attachments folder when attached, creating a 1:1
    relationship between the attachment record and the file.

    Attributes
    ----------
    id : UUID
        Unique identifier for the attachment (primary key).
    organization_id : UUID
        Organization this attachment belongs to (foreign key).
    file_id : UUID
        The file in the Attachments folder (unique, 1:1 relationship).
    content_type : ContentType
        Type of content this file is attached to (NOTE, CHAT_MESSAGE, etc.).
    content_id : UUID
        ID of the content this file is attached to.
    attached_by_user_id : UUID
        User who attached the file (foreign key to login_users).
    attached_at : datetime
        Timestamp when the file was attached.

    """

    __tablename__ = "attachments_attachments"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    file_id: UUID = Field(foreign_key="files_files.id", unique=True, nullable=False, index=True)
    content_type: ContentType = Field(
        sa_column=Column(
            SAEnum(
                ContentType,
                name="contenttype",
                values_callable=lambda x: [e.value for e in x],
                create_type=False,
            ),
            nullable=False,
            index=True,
        ),
    )
    content_id: UUID = Field(nullable=False, index=True)
    attached_by_user_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    attached_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    __table_args__ = (Index("ix_attachments_content", "content_type", "content_id"),)

    def __repr__(self) -> str:
        """Return string representation of Attachment."""
        return (
            f"<Attachment(id={self.id}, file_id={self.file_id}, "
            f"content_type={self.content_type}, content_id={self.content_id})>"
        )
