"""CommentReaction model for emoji reactions on comments."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Index, String, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class CommentReaction(SQLModel, table=True):
    """Emoji reaction on a comment; unique per (comment, user, emoji)."""

    __tablename__ = "comments_reactions"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    comment_id: UUID = Field(
        foreign_key="comments_comments.id",
        nullable=False,
        index=True,
    )
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    emoji: str = Field(sa_column=Column(String(32), nullable=False))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    __table_args__ = (
        UniqueConstraint("comment_id", "user_id", "emoji", name="uq_comment_reaction"),
        Index("ix_comments_reactions_comment_id", "comment_id"),
    )

    def __repr__(self) -> str:
        return (
            f"<CommentReaction(id={self.id}, comment_id={self.comment_id}, "
            f"user_id={self.user_id}, emoji={self.emoji})>"
        )
