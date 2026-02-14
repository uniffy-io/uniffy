"""Comment model for content discussions."""

from datetime import UTC, datetime
from enum import Enum
from uuid import UUID

from sqlalchemy import Column, DateTime, Index, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.models.shared import ContentType
from uniffy.core.types import generate_id


class CommentAnchorType(str, Enum):
    """
    Anchor type for comment positioning.

    Defines where a comment is anchored within the content.

    Attributes
    ----------
    PAGE : str
        Page-level comment with no specific anchor.
    SELECTION : str
        Text selection anchor with position data.
    BLOCK : str
        Block-level anchor (heading, paragraph, etc.).
    MEDIA : str
        Media pin anchor (image region, video timestamp).

    """

    PAGE = "PAGE"
    SELECTION = "SELECTION"
    BLOCK = "BLOCK"
    MEDIA = "MEDIA"


class Comment(SQLModel, table=True):
    """
    Comment model for content discussions.

    Each comment is attached to a piece of content (note, file, calendar event, etc.)
    via the polymorphic content_type + content_id pattern. Comments support threading
    via parent_comment_id, text selection anchors, and resolution tracking.

    Attributes
    ----------
    id : UUID
        Unique identifier for the comment (primary key).
    organization_id : UUID
        Organization this comment belongs to (foreign key).
    content_type : ContentType
        Type of content this comment is on (NOTE, FILE, etc.).
    content_id : UUID
        ID of the content this comment is on.
    parent_comment_id : UUID | None
        Parent comment ID for threaded replies (self-referential FK).
    author_id : UUID
        User who authored the comment (foreign key).
    body : str
        Comment body in Markdown with [[[label|urn]]] mention support.
    anchor_type : CommentAnchorType
        Where the comment is anchored within the content.
    anchor_data : dict | None
        Anchor-specific data (positions, coordinates, text, etc.).
    is_resolved : bool
        Whether the comment thread is resolved.
    resolved_by : UUID | None
        User who resolved the comment.
    resolved_at : datetime | None
        When the comment was resolved.
    is_deleted : bool
        Whether the comment is soft-deleted.
    deleted_at : datetime | None
        When the comment was soft-deleted.
    created_at : datetime
        When the comment was created.
    updated_at : datetime | None
        When the comment was last updated.

    """

    __tablename__ = "comments_comments"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(
        foreign_key="login_organizations.id", nullable=False, index=True
    )
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
    parent_comment_id: UUID | None = Field(
        default=None,
        foreign_key="comments_comments.id",
        nullable=True,
        index=True,
    )
    author_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    body: str = Field(sa_column=Column(Text, nullable=False))
    anchor_type: CommentAnchorType = Field(
        sa_column=Column(
            SAEnum(
                CommentAnchorType,
                name="comment_anchor_type",
                values_callable=lambda x: [e.value for e in x],
                create_type=False,
            ),
            nullable=False,
            default=CommentAnchorType.PAGE,
        ),
    )
    anchor_data: dict | None = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
    )
    is_resolved: bool = Field(default=False, nullable=False)
    resolved_by: UUID | None = Field(
        default=None, foreign_key="login_users.id", nullable=True
    )
    resolved_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    is_deleted: bool = Field(default=False, nullable=False)
    deleted_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )

    __table_args__ = (
        Index(
            "ix_comments_org_content",
            "organization_id",
            "content_type",
            "content_id",
        ),
    )

    def __repr__(self) -> str:
        """Return string representation of Comment."""
        return (
            f"<Comment(id={self.id}, content_type={self.content_type}, "
            f"content_id={self.content_id}, author_id={self.author_id})>"
        )
