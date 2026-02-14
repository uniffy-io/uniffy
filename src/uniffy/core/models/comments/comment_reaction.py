"""CommentReaction model for emoji reactions on comments."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Index, String, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class CommentReaction(SQLModel, table=True):
    """
    Reaction model for comments.

    Each reaction links a user + emoji to a comment. The unique constraint
    on (comment_id, user_id, emoji) prevents duplicate reactions.

    Attributes
    ----------
    id : UUID
        Unique identifier for the reaction (primary key).
    comment_id : UUID
        Comment this reaction is on (foreign key, CASCADE delete).
    user_id : UUID
        User who added the reaction (foreign key).
    emoji : str
        Emoji character or shortcode (max 32 chars).
    created_at : datetime
        When the reaction was added.

    """

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
        """Return string representation of CommentReaction."""
        return (
            f"<CommentReaction(id={self.id}, comment_id={self.comment_id}, "
            f"user_id={self.user_id}, emoji={self.emoji})>"
        )
