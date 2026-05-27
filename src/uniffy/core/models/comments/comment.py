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
    """Where a comment is anchored within its target content."""

    PAGE = "PAGE"
    SELECTION = "SELECTION"
    BLOCK = "BLOCK"
    MEDIA = "MEDIA"


class Comment(SQLModel, table=True):
    """Threaded comment attached to any content type via (content_type, content_id)."""

    __tablename__ = "comments_comments"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
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
    resolved_by: UUID | None = Field(default=None, foreign_key="login_users.id", nullable=True)
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
        return (
            f"<Comment(id={self.id}, content_type={self.content_type}, "
            f"content_id={self.content_id}, author_id={self.author_id})>"
        )
