"""SQL query helpers for comments domain."""

from uuid import UUID

from sqlalchemy import Select, and_, func, select
from sqlalchemy.orm import aliased

from uniffy.core.models.comments.comment import Comment, CommentAnchorType
from uniffy.core.models.comments.comment_reaction import CommentReaction
from uniffy.core.models.login.user import User
from uniffy.core.models.shared import ContentType


def build_comments_query(
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
    is_resolved: bool | None = None,
    anchor_type: CommentAnchorType | None = None,
    top_level_only: bool = True,
) -> Select:
    """
    Build query for comments with author info.

    Returns top-level comments (no parent) by default, joined with
    User table for author name and avatar.

    Parameters
    ----------
    organization_id : UUID
        Organization ID.
    content_type : ContentType
        Content type filter.
    content_id : UUID
        Content ID filter.
    is_resolved : bool | None
        Filter by resolved status.
    anchor_type : CommentAnchorType | None
        Filter by anchor type.
    top_level_only : bool
        If True, only return top-level comments (no parent).

    Returns
    -------
    Select
        SQLAlchemy select query.

    """
    author = aliased(User)

    query = (
        select(Comment, author.full_name)
        .join(author, Comment.author_id == author.id)
        .where(
            Comment.organization_id == organization_id,
            Comment.content_type == content_type,
            Comment.content_id == content_id,
            Comment.is_deleted == False,  # noqa: E712
        )
    )

    if top_level_only:
        query = query.where(Comment.parent_comment_id == None)  # noqa: E711

    if is_resolved is not None:
        query = query.where(Comment.is_resolved == is_resolved)

    if anchor_type is not None:
        query = query.where(Comment.anchor_type == anchor_type)

    return query.order_by(Comment.created_at.asc())


def build_reply_count_subquery() -> Select:
    """
    Build a correlated subquery for reply counts.

    Returns
    -------
    Select
        Scalar subquery counting non-deleted replies.

    """
    return (
        select(func.count())
        .where(
            and_(
                Comment.parent_comment_id == Comment.id,
                Comment.is_deleted == False,  # noqa: E712
            )
        )
        .correlate(Comment)
        .scalar_subquery()
    )


def count_comments_query(
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
    is_resolved: bool | None = None,
) -> Select:
    """
    Build a count query for comments.

    Parameters
    ----------
    organization_id : UUID
        Organization ID.
    content_type : ContentType
        Content type filter.
    content_id : UUID
        Content ID filter.
    is_resolved : bool | None
        Filter by resolved status.

    Returns
    -------
    Select
        Count query.

    """
    query = select(func.count()).where(
        Comment.organization_id == organization_id,
        Comment.content_type == content_type,
        Comment.content_id == content_id,
        Comment.is_deleted == False,  # noqa: E712
        Comment.parent_comment_id == None,  # noqa: E711
    )

    if is_resolved is not None:
        query = query.where(Comment.is_resolved == is_resolved)

    return query


async def aggregate_reactions(
    session,
    comment_id: UUID,
) -> list[dict]:
    """
    Aggregate reactions for a comment by emoji.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    comment_id : UUID
        Comment ID.

    Returns
    -------
    list[dict]
        List of dicts with emoji, count, user_ids.

    """
    result = await session.execute(
        select(
            CommentReaction.emoji,
            func.count().label("count"),
            func.array_agg(CommentReaction.user_id).label("user_ids"),
        )
        .where(CommentReaction.comment_id == comment_id)
        .group_by(CommentReaction.emoji)
        .order_by(func.count().desc())
    )

    reactions = []
    for row in result.all():
        reactions.append({
            "emoji": row.emoji,
            "count": row.count,
            "user_ids": [str(uid) for uid in row.user_ids] if row.user_ids else [],
        })

    return reactions
