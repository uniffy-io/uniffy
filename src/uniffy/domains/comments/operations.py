"""Business logic for comments domain."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete, func, select, tuple_, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.events import NotificationEvent, emit_notification
from uniffy.core.models.comments.comment import Comment, CommentAnchorType
from uniffy.core.models.comments.comment_reaction import CommentReaction
from uniffy.core.models.login.user import User
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import (
    ContentType,
    NotificationType,
    generate_id,
)
from uniffy.domains.comments.access import CommentTargetAccess
from uniffy.domains.comments.queries import (
    aggregate_reactions,
    build_comments_query,
    count_comments_query,
)
from uniffy.domains.permissions.resource_access import (
    ResourceAccessPurpose,
    ResourceAccessResolver,
    ResourceKey,
)


def _comment_snippet(body: str, limit: int = 140) -> str:
    text = " ".join(body.split())
    return f"{text[:limit]}..." if len(text) > limit else text


class CommentOperations:
    """Comments require COMMENTER on parent to add, VIEW to read, EDIT to resolve/reopen."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._target_access = CommentTargetAccess(session)

    async def create_comment(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        body: str,
        anchor_type: CommentAnchorType = CommentAnchorType.PAGE,
        anchor_data: dict | None = None,
        parent_comment_id: UUID | None = None,
    ) -> tuple[Comment, str, str | None]:
        """Create a comment; requires COMMENTER on the parent content."""
        await self._verify_content_comment(user_id, organization_id, content_type, content_id)

        parent_author_id: UUID | None = None
        if parent_comment_id:
            parent = await self._get_comment(parent_comment_id, organization_id)
            if not parent:
                raise NotFoundError("Comment", str(parent_comment_id))
            if parent.content_type != content_type or parent.content_id != content_id:
                raise NotFoundError("Comment", str(parent_comment_id))
            parent_author_id = parent.author_id

        author_name, author_avatar = await self._get_user_info(user_id)

        comment = Comment(
            id=generate_id(),
            organization_id=organization_id,
            content_type=content_type,
            content_id=content_id,
            parent_comment_id=parent_comment_id,
            author_id=user_id,
            body=body,
            anchor_type=anchor_type,
            anchor_data=anchor_data,
        )
        self._session.add(comment)
        await self._session.flush()
        await self._session.commit()
        await self._session.refresh(comment)

        await self._emit_comment_notifications(comment, user_id, parent_author_id)

        return comment, author_name, author_avatar

    async def update_comment(
        self,
        user_id: UUID,
        organization_id: UUID,
        comment_id: UUID,
        body: str,
    ) -> tuple[Comment, str, str | None]:
        """Update a comment body; author-only."""
        comment = await self._get_comment(comment_id, organization_id)
        if not comment:
            raise NotFoundError("Comment", str(comment_id))

        if comment.author_id != user_id:
            raise PermissionDeniedError("edit", "comment")
        await self._verify_content_access(
            user_id, organization_id, comment.content_type, comment.content_id
        )

        comment.body = body
        comment.updated_at = datetime.now(UTC)
        await self._session.flush()
        await self._session.commit()
        await self._session.refresh(comment)

        author_name, author_avatar = await self._get_user_info(comment.author_id)
        return comment, author_name, author_avatar

    async def delete_comment(
        self,
        user_id: UUID,
        organization_id: UUID,
        comment_id: UUID,
    ) -> bool:
        """Soft-delete; author always allowed, otherwise needs EDIT on parent."""
        comment = await self._get_comment(comment_id, organization_id)
        if not comment:
            raise NotFoundError("Comment", str(comment_id))

        if comment.author_id == user_id:
            await self._verify_content_access(
                user_id, organization_id, comment.content_type, comment.content_id
            )
        else:
            await self._verify_content_edit(
                user_id, organization_id, comment.content_type, comment.content_id
            )

        comment.is_deleted = True
        comment.deleted_at = datetime.now(UTC)
        await self._session.flush()
        await self._session.commit()

        return True

    async def list_comments(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
        is_resolved: bool | None = None,
        anchor_type: CommentAnchorType | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[
        list[
            tuple[Comment, str, str | None, int, list[dict], list[tuple[Comment, str, list[dict]]]]
        ],
        int,
        int,
        int,
    ]:
        """List comments with author, reactions, and nested replies; requires VIEW on parent."""
        await self._verify_content_access(user_id, organization_id, content_type, content_id)

        total_count = (
            await self._session.execute(
                count_comments_query(organization_id, content_type, content_id)
            )
        ).scalar() or 0

        open_count = (
            await self._session.execute(
                count_comments_query(organization_id, content_type, content_id, is_resolved=False)
            )
        ).scalar() or 0

        resolved_count = (
            await self._session.execute(
                count_comments_query(organization_id, content_type, content_id, is_resolved=True)
            )
        ).scalar() or 0

        query = build_comments_query(
            organization_id, content_type, content_id, is_resolved, anchor_type
        )
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self._session.execute(query)
        rows = result.all()

        parent_ids = [row[0].id for row in rows]
        replies_by_parent = await self._load_replies(parent_ids)

        comments_data = []
        for row in rows:
            comment = row[0]
            author_name = row[1] or "Unknown"
            reactions = await aggregate_reactions(self._session, comment.id)
            replies = replies_by_parent.get(comment.id, [])
            comments_data.append((comment, author_name, None, len(replies), reactions, replies))

        return comments_data, total_count, open_count, resolved_count

    async def _load_replies(
        self, parent_ids: list[UUID]
    ) -> dict[UUID, list[tuple[Comment, str, list[dict]]]]:
        """Batch-load non-deleted replies for the given parents, grouped by parent id."""
        if not parent_ids:
            return {}

        from sqlalchemy.orm import aliased

        author = aliased(User)
        result = await self._session.execute(
            select(Comment, author.full_name)
            .join(author, Comment.author_id == author.id)
            .where(
                Comment.parent_comment_id.in_(parent_ids),
                Comment.is_deleted == False,  # noqa: E712
            )
            .order_by(Comment.created_at.asc())
        )

        grouped: dict[UUID, list[tuple[Comment, str, list[dict]]]] = {}
        for reply, reply_author_name in result.all():
            reactions = await aggregate_reactions(self._session, reply.id)
            grouped.setdefault(reply.parent_comment_id, []).append((
                reply,
                reply_author_name or "Unknown",
                reactions,
            ))
        return grouped

    async def get_comment(
        self,
        user_id: UUID,
        organization_id: UUID,
        comment_id: UUID,
    ) -> tuple[Comment, str, str | None, int, list[dict], list[tuple]]:
        """Comment + replies; each reply is (comment, name, avatar, reply_count, reactions)."""
        comment = await self._get_comment(comment_id, organization_id)
        if not comment:
            raise NotFoundError("Comment", str(comment_id))

        await self._verify_content_access(
            user_id, organization_id, comment.content_type, comment.content_id
        )

        author_name, author_avatar = await self._get_user_info(comment.author_id)
        reactions = await aggregate_reactions(self._session, comment.id)

        from sqlalchemy.orm import aliased

        reply_author = aliased(User)
        reply_query = (
            select(Comment, reply_author.full_name)
            .join(reply_author, Comment.author_id == reply_author.id)
            .where(
                Comment.parent_comment_id == comment_id,
                Comment.is_deleted == False,  # noqa: E712
            )
            .order_by(Comment.created_at.asc())
        )
        reply_result = await self._session.execute(reply_query)
        reply_rows = reply_result.all()

        replies = []
        for row in reply_rows:
            reply = row[0]
            reply_name = row[1] or "Unknown"
            reply_reactions = await aggregate_reactions(self._session, reply.id)
            replies.append((reply, reply_name, None, 0, reply_reactions))

        reply_count = len(replies)

        return comment, author_name, author_avatar, reply_count, reactions, replies

    async def resolve_comment(
        self,
        user_id: UUID,
        organization_id: UUID,
        comment_id: UUID,
    ) -> tuple[Comment, str, str | None]:
        """Resolve a comment; requires EDIT on parent content."""
        comment = await self._get_comment(comment_id, organization_id)
        if not comment:
            raise NotFoundError("Comment", str(comment_id))

        await self._verify_content_edit(
            user_id, organization_id, comment.content_type, comment.content_id
        )

        comment.is_resolved = True
        comment.resolved_by = user_id
        comment.resolved_at = datetime.now(UTC)
        comment.updated_at = datetime.now(UTC)
        await self._session.flush()
        await self._session.commit()
        await self._session.refresh(comment)

        author_name, author_avatar = await self._get_user_info(comment.author_id)
        return comment, author_name, author_avatar

    async def reopen_comment(
        self,
        user_id: UUID,
        organization_id: UUID,
        comment_id: UUID,
    ) -> tuple[Comment, str, str | None]:
        """Reopen a resolved comment; requires EDIT on parent content."""
        comment = await self._get_comment(comment_id, organization_id)
        if not comment:
            raise NotFoundError("Comment", str(comment_id))

        await self._verify_content_edit(
            user_id, organization_id, comment.content_type, comment.content_id
        )

        comment.is_resolved = False
        comment.resolved_by = None
        comment.resolved_at = None
        comment.updated_at = datetime.now(UTC)
        await self._session.flush()
        await self._session.commit()
        await self._session.refresh(comment)

        author_name, author_avatar = await self._get_user_info(comment.author_id)
        return comment, author_name, author_avatar

    async def add_reaction(
        self,
        user_id: UUID,
        organization_id: UUID,
        comment_id: UUID,
        emoji: str,
    ) -> bool:
        """Add a reaction; idempotent. Requires COMMENTER on parent; removal
        stays at VIEW so a demoted user can still take their own reaction back."""
        comment = await self._get_comment(comment_id, organization_id)
        if not comment:
            raise NotFoundError("Comment", str(comment_id))

        await self._verify_content_comment(
            user_id, organization_id, comment.content_type, comment.content_id
        )

        existing = await self._session.execute(
            select(CommentReaction).where(
                CommentReaction.comment_id == comment_id,
                CommentReaction.user_id == user_id,
                CommentReaction.emoji == emoji,
            )
        )
        if existing.scalar_one_or_none():
            return True

        reaction = CommentReaction(
            id=generate_id(),
            comment_id=comment_id,
            user_id=user_id,
            emoji=emoji,
        )
        self._session.add(reaction)
        await self._session.flush()
        await self._session.commit()

        return True

    async def remove_reaction(
        self,
        user_id: UUID,
        organization_id: UUID,
        comment_id: UUID,
        emoji: str,
    ) -> bool:
        """Remove a reaction; users can only remove their own."""
        comment = await self._get_comment(comment_id, organization_id)
        if not comment:
            raise NotFoundError("Comment", str(comment_id))
        await self._verify_content_access(
            user_id, organization_id, comment.content_type, comment.content_id
        )
        await self._session.execute(
            delete(CommentReaction).where(
                CommentReaction.comment_id == comment_id,
                CommentReaction.user_id == user_id,
                CommentReaction.emoji == emoji,
            )
        )
        await self._session.commit()
        return True

    async def get_comment_counts(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_refs: list[tuple[ContentType, UUID]],
    ) -> dict[str, int]:
        """Returns {"content_type:content_id": count} for the requested refs."""
        if not content_refs:
            return {}

        keys = list(dict.fromkeys(ResourceKey(ct, cid) for ct, cid in content_refs))
        decisions = await ResourceAccessResolver(self._session).resolve(
            actor_id=user_id,
            organization_id=organization_id,
            keys=keys,
            purpose=ResourceAccessPurpose.LIST,
        )
        visible = [key for key in keys if decisions[key].can_view]
        if not visible:
            return {}

        result = await self._session.execute(
            select(
                Comment.content_type,
                Comment.content_id,
                func.count().label("count"),
            )
            .where(
                Comment.organization_id == organization_id,
                Comment.is_deleted == False,  # noqa: E712
                Comment.parent_comment_id == None,  # noqa: E711
                tuple_(Comment.content_type, Comment.content_id).in_([
                    (key.content_type, key.content_id) for key in visible
                ]),
            )
            .group_by(Comment.content_type, Comment.content_id)
        )

        counts = {}
        for row in result.all():
            key = f"{row.content_type.value}:{row.content_id}"
            counts[key] = row.count

        for resource in visible:
            key = f"{resource.content_type.value}:{resource.content_id}"
            if key not in counts:
                counts[key] = 0

        return counts

    async def delete_all_for_content(
        self,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> int:
        """Cascade soft-delete all comments for a piece of content."""
        result = await self._session.execute(
            update(Comment)
            .where(
                Comment.organization_id == organization_id,
                Comment.content_type == content_type,
                Comment.content_id == content_id,
            )
            .values(is_deleted=True, deleted_at=datetime.now(UTC))
        )
        await self._session.commit()
        return result.rowcount  # type: ignore[return-value]

    async def _emit_comment_notifications(
        self,
        comment: Comment,
        actor_id: UUID,
        parent_author_id: UUID | None,
    ) -> None:
        """Notify the parent author on a reply and every other prior commenter on the content."""
        source_urn = build_content_urn(comment.content_type, comment.content_id)
        snippet = _comment_snippet(comment.body)

        reply_recipient: UUID | None = None
        if parent_author_id and parent_author_id != actor_id:
            reply_recipient = parent_author_id
            await emit_notification(
                NotificationEvent(
                    notification_type=NotificationType.COMMENT_REPLY,
                    organization_id=comment.organization_id,
                    actor_id=actor_id,
                    title="replied to your comment",
                    body=snippet,
                    source_urn=source_urn,
                    target_user_ids=[reply_recipient],
                )
            )

        participants = await self._get_thread_participant_ids(
            comment.organization_id, comment.content_type, comment.content_id
        )
        participants.discard(actor_id)
        if reply_recipient:
            participants.discard(reply_recipient)

        if participants:
            await emit_notification(
                NotificationEvent(
                    notification_type=NotificationType.COMMENT_ADDED,
                    organization_id=comment.organization_id,
                    actor_id=actor_id,
                    title="commented on a thread you're in",
                    body=snippet,
                    source_urn=source_urn,
                    target_user_ids=list(participants),
                )
            )

    async def _get_thread_participant_ids(
        self,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> set[UUID]:
        """Distinct authors of every non-deleted comment on a piece of content."""
        result = await self._session.execute(
            select(Comment.author_id)
            .distinct()
            .where(
                Comment.organization_id == organization_id,
                Comment.content_type == content_type,
                Comment.content_id == content_id,
                Comment.is_deleted == False,  # noqa: E712
            )
        )
        return {row[0] for row in result.all()}

    async def _get_comment(self, comment_id: UUID, organization_id: UUID) -> Comment | None:
        result = await self._session.execute(
            select(Comment).where(
                Comment.id == comment_id,
                Comment.organization_id == organization_id,
                Comment.is_deleted == False,  # noqa: E712
            )
        )
        return result.scalar_one_or_none()

    async def _get_user_info(self, user_id: UUID) -> tuple[str, str | None]:
        result = await self._session.execute(select(User.full_name).where(User.id == user_id))
        row = result.one_or_none()
        if not row:
            return "Unknown", None
        return row[0] or "Unknown", None

    async def _verify_content_access(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> None:
        await self._target_access.require_view(
            user_id,
            organization_id,
            content_type,
            content_id,
        )

    async def _verify_content_comment(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> None:
        await self._target_access.require_comment(
            user_id,
            organization_id,
            content_type,
            content_id,
        )

    async def _verify_content_edit(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> None:
        await self._target_access.require_edit(
            user_id,
            organization_id,
            content_type,
            content_id,
        )
