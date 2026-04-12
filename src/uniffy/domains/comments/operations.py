"""Business logic for comments domain."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import and_, delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions import role_can_edit, role_can_view
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.comments.comment import Comment, CommentAnchorType
from uniffy.core.models.comments.comment_reaction import CommentReaction
from uniffy.core.models.files.file import File
from uniffy.core.models.login.user import User
from uniffy.core.types import AccessMode, ContentRole, ContentType, generate_id
from uniffy.domains.comments.queries import (
    aggregate_reactions,
    build_comments_query,
    count_comments_query,
)


class CommentOperations:
    """
    Business logic for comment operations.

    Follows the pattern from AttachmentsOperations -- uses PermissionChecker
    for access control on parent content. Comments require VIEW permission
    to add, EDIT permission to resolve/reopen.

    Parameters
    ----------
    session : AsyncSession
        Database session.

    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

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
        """
        Create a new comment on content.

        Requires VIEW permission on the parent content.

        Parameters
        ----------
        user_id : UUID
            Author's user ID.
        organization_id : UUID
            Organization ID.
        content_type : ContentType
            Type of content being commented on.
        content_id : UUID
            ID of the content.
        body : str
            Comment body in Markdown.
        anchor_type : CommentAnchorType
            Where the comment is anchored.
        anchor_data : dict | None
            Anchor-specific data.
        parent_comment_id : UUID | None
            Parent comment ID for replies.

        Returns
        -------
        tuple[Comment, str, str | None]
            Created comment, author name, and author avatar URL.

        """
        await self._verify_content_access(user_id, organization_id, content_type, content_id)

        # Validate parent comment exists if replying
        if parent_comment_id:
            parent = await self._get_comment(parent_comment_id, organization_id)
            if not parent:
                raise NotFoundError("Comment", str(parent_comment_id))

        # Get author info
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

        return comment, author_name, author_avatar

    async def update_comment(
        self,
        user_id: UUID,
        organization_id: UUID,
        comment_id: UUID,
        body: str,
    ) -> tuple[Comment, str, str | None]:
        """
        Update a comment's body.

        Only the author can update their own comment.

        Parameters
        ----------
        user_id : UUID
            User performing the update.
        organization_id : UUID
            Organization ID.
        comment_id : UUID
            Comment to update.
        body : str
            New comment body.

        Returns
        -------
        tuple[Comment, str, str | None]
            Updated comment, author name, and avatar URL.

        """
        comment = await self._get_comment(comment_id, organization_id)
        if not comment:
            raise NotFoundError("Comment", str(comment_id))

        if comment.author_id != user_id:
            raise PermissionDeniedError("edit", "comment")

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
        """
        Soft-delete a comment.

        Author or content ADMIN can delete.

        Parameters
        ----------
        user_id : UUID
            User performing the delete.
        organization_id : UUID
            Organization ID.
        comment_id : UUID
            Comment to delete.

        Returns
        -------
        bool
            True if deleted.

        """
        comment = await self._get_comment(comment_id, organization_id)
        if not comment:
            raise NotFoundError("Comment", str(comment_id))

        # Author can always delete their own comment
        if comment.author_id != user_id:
            # Otherwise check EDIT permission on parent content
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
    ) -> tuple[list[tuple[Comment, str, str | None, int, list[dict]]], int, int, int]:
        """
        List comments for content with author info and reaction data.

        Requires VIEW permission on the parent content.

        Parameters
        ----------
        user_id : UUID
            User requesting the list.
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
        page : int
            Page number (1-indexed).
        page_size : int
            Items per page.

        Returns
        -------
        tuple[list[tuple], int, int, int]
            List of (comment, author_name, avatar_url, reply_count, reactions),
            total_count, open_count, resolved_count.

        """
        await self._verify_content_access(user_id, organization_id, content_type, content_id)

        # Get counts
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

        # Get comments with author info
        query = build_comments_query(
            organization_id, content_type, content_id, is_resolved, anchor_type
        )
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self._session.execute(query)
        rows = result.all()

        comments_data = []
        for row in rows:
            comment = row[0]
            author_name = row[1] or "Unknown"

            # Get reply count
            reply_count_result = await self._session.execute(
                select(func.count()).where(
                    Comment.parent_comment_id == comment.id,
                    Comment.is_deleted == False,  # noqa: E712
                )
            )
            reply_count = reply_count_result.scalar() or 0

            # Get aggregated reactions
            reactions = await aggregate_reactions(self._session, comment.id)

            comments_data.append((comment, author_name, None, reply_count, reactions))

        return comments_data, total_count, open_count, resolved_count

    async def get_comment(
        self,
        user_id: UUID,
        organization_id: UUID,
        comment_id: UUID,
    ) -> tuple[Comment, str, str | None, int, list[dict], list[tuple]]:
        """
        Get a single comment with replies.

        Parameters
        ----------
        user_id : UUID
            User requesting the comment.
        organization_id : UUID
            Organization ID.
        comment_id : UUID
            Comment to get.

        Returns
        -------
        tuple
            (comment, author_name, avatar_url, reply_count, reactions, replies).
            Each reply is (comment, author_name, avatar_url, reply_count, reactions).

        """
        comment = await self._get_comment(comment_id, organization_id)
        if not comment:
            raise NotFoundError("Comment", str(comment_id))

        await self._verify_content_access(
            user_id, organization_id, comment.content_type, comment.content_id
        )

        author_name, author_avatar = await self._get_user_info(comment.author_id)
        reactions = await aggregate_reactions(self._session, comment.id)

        # Get replies
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
        """
        Resolve a comment thread.

        Requires EDIT permission on parent content.

        Parameters
        ----------
        user_id : UUID
            User resolving the comment.
        organization_id : UUID
            Organization ID.
        comment_id : UUID
            Comment to resolve.

        Returns
        -------
        tuple[Comment, str, str | None]
            Resolved comment, author name, avatar URL.

        """
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
        """
        Reopen a resolved comment thread.

        Requires EDIT permission on parent content.

        Parameters
        ----------
        user_id : UUID
            User reopening the comment.
        organization_id : UUID
            Organization ID.
        comment_id : UUID
            Comment to reopen.

        Returns
        -------
        tuple[Comment, str, str | None]
            Reopened comment, author name, avatar URL.

        """
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
        """
        Add a reaction to a comment.

        Requires VIEW permission on parent content.

        Parameters
        ----------
        user_id : UUID
            User adding the reaction.
        organization_id : UUID
            Organization ID.
        comment_id : UUID
            Comment to react to.
        emoji : str
            Emoji character or shortcode.

        Returns
        -------
        bool
            True if reaction was added.

        """
        comment = await self._get_comment(comment_id, organization_id)
        if not comment:
            raise NotFoundError("Comment", str(comment_id))

        await self._verify_content_access(
            user_id, organization_id, comment.content_type, comment.content_id
        )

        # Check if reaction already exists
        existing = await self._session.execute(
            select(CommentReaction).where(
                CommentReaction.comment_id == comment_id,
                CommentReaction.user_id == user_id,
                CommentReaction.emoji == emoji,
            )
        )
        if existing.scalar_one_or_none():
            return True  # Already reacted

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
        """
        Remove a reaction from a comment.

        Users can only remove their own reactions.

        Parameters
        ----------
        user_id : UUID
            User removing the reaction.
        organization_id : UUID
            Organization ID.
        comment_id : UUID
            Comment to remove reaction from.
        emoji : str
            Emoji to remove.

        Returns
        -------
        bool
            True if removed.

        """
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
        """
        Get comment counts for multiple content items.

        Parameters
        ----------
        user_id : UUID
            User requesting counts.
        organization_id : UUID
            Organization ID.
        content_refs : list[tuple[ContentType, UUID]]
            List of (content_type, content_id) tuples.

        Returns
        -------
        dict[str, int]
            Map of "content_type:content_id" to count.

        """
        if not content_refs:
            return {}

        # Build conditions for each content ref
        conditions = []
        for ct, cid in content_refs:
            conditions.append(and_(Comment.content_type == ct, Comment.content_id == cid))

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
            )
            .where(
                # OR all conditions together
                func.bool_or(*[
                    and_(Comment.content_type == ct, Comment.content_id == cid)
                    for ct, cid in content_refs
                ])
                if len(content_refs) > 1
                else conditions[0]
            )
            .group_by(Comment.content_type, Comment.content_id)
        )

        counts = {}
        for row in result.all():
            key = f"{row.content_type}:{row.content_id}"
            counts[key] = row.count

        # Fill in zeros for missing refs
        for ct, cid in content_refs:
            key = f"{ct.value}:{cid}"
            if key not in counts:
                counts[key] = 0

        return counts

    async def delete_all_for_content(
        self,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> int:
        """
        Delete all comments for a piece of content.

        Used for cascade cleanup when parent content is deleted.

        Parameters
        ----------
        organization_id : UUID
            Organization ID.
        content_type : ContentType
            Content type.
        content_id : UUID
            Content ID.

        Returns
        -------
        int
            Number of comments deleted.

        """
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

    # Private helpers

    async def _get_comment(self, comment_id: UUID, organization_id: UUID) -> Comment | None:
        """Get a comment by ID."""
        result = await self._session.execute(
            select(Comment).where(
                Comment.id == comment_id,
                Comment.organization_id == organization_id,
                Comment.is_deleted == False,  # noqa: E712
            )
        )
        return result.scalar_one_or_none()

    async def _get_user_info(self, user_id: UUID) -> tuple[str, str | None]:
        """Get user display name and avatar URL."""
        result = await self._session.execute(select(User.full_name).where(User.id == user_id))
        row = result.one_or_none()
        if not row:
            return "Unknown", None
        return row[0] or "Unknown", None

    async def _resolve_parent_role(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> ContentRole | None:
        """Return the user's effective role on the parent content.

        Comments inherit their access policy from the parent content
        item. Tasks delegate to their parent project.
        """
        from uniffy.core.auth.permissions.checker import PermissionChecker

        owner_id, access_mode, baseline_role, resolved_type, resolved_id = (
            await self._load_parent_policy(
                organization_id, content_type, content_id
            )
        )

        checker = PermissionChecker(self._session)
        return await checker.effective_role(
            user_id=user_id,
            organization_id=organization_id,
            content_type=resolved_type,
            content_id=resolved_id,
            owner_id=owner_id,
            access_mode=access_mode,
            baseline_role=baseline_role,
        )

    async def _load_parent_policy(
        self,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> tuple[UUID, AccessMode, ContentRole | None, ContentType, UUID]:
        """Load (owner_id, access_mode, baseline_role, type, id) for a parent.

        Tasks are not access-controlled themselves; they defer to the
        owning project. The returned ``(type, id)`` pair is what the
        permission checker should use -- for tasks this is the project.
        """
        if content_type == ContentType.NOTE:
            from uniffy.core.models.notes.note import Note

            result = await self._session.execute(
                select(Note.owner_id, Note.access_mode, Note.baseline_role).where(
                    Note.id == content_id,
                    Note.organization_id == organization_id,
                )
            )
            row = result.one_or_none()
            if not row:
                raise NotFoundError("Note", str(content_id))
            return row[0], row[1], row[2], content_type, content_id

        if content_type == ContentType.FILE:
            result = await self._session.execute(
                select(File.owner_id, File.access_mode, File.baseline_role).where(
                    File.id == content_id,
                    File.organization_id == organization_id,
                )
            )
            row = result.one_or_none()
            if not row:
                raise NotFoundError("File", str(content_id))
            return row[0], row[1], row[2], content_type, content_id

        if content_type == ContentType.CALENDAR_EVENT:
            from uniffy.core.models.calendar.event import CalendarEvent

            result = await self._session.execute(
                select(
                    CalendarEvent.organizer_id,
                    CalendarEvent.access_mode,
                    CalendarEvent.baseline_role,
                ).where(
                    CalendarEvent.id == content_id,
                    CalendarEvent.organization_id == organization_id,
                )
            )
            row = result.one_or_none()
            if not row:
                raise NotFoundError("CalendarEvent", str(content_id))
            return row[0], row[1], row[2], content_type, content_id

        if content_type == ContentType.PROJECT:
            from uniffy.core.models.projects.project import Project

            result = await self._session.execute(
                select(
                    Project.owner_id, Project.access_mode, Project.baseline_role
                ).where(
                    Project.id == content_id,
                    Project.organization_id == organization_id,
                )
            )
            row = result.one_or_none()
            if not row:
                raise NotFoundError("Project", str(content_id))
            return row[0], row[1], row[2], content_type, content_id

        if content_type == ContentType.TASK:
            from uniffy.core.models.projects.project import Project
            from uniffy.core.models.projects.task import Task

            task_result = await self._session.execute(
                select(Task.project_id).where(
                    Task.id == content_id,
                    Task.organization_id == organization_id,
                )
            )
            task_row = task_result.one_or_none()
            if not task_row:
                raise NotFoundError("Task", str(content_id))
            project_id = task_row[0]

            proj_result = await self._session.execute(
                select(
                    Project.owner_id, Project.access_mode, Project.baseline_role
                ).where(
                    Project.id == project_id,
                    Project.organization_id == organization_id,
                )
            )
            proj_row = proj_result.one_or_none()
            if not proj_row:
                raise NotFoundError("Project", str(project_id))
            return proj_row[0], proj_row[1], proj_row[2], ContentType.PROJECT, project_id

        raise NotFoundError("Content", str(content_id))

    async def _verify_content_access(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> None:
        """Verify the user can view the parent content."""
        role = await self._resolve_parent_role(
            user_id, organization_id, content_type, content_id
        )
        if not role_can_view(role):
            raise PermissionDeniedError("access", "content")

    async def _verify_content_edit(
        self,
        user_id: UUID,
        organization_id: UUID,
        content_type: ContentType,
        content_id: UUID,
    ) -> None:
        """Verify the user can edit the parent content."""
        role = await self._resolve_parent_role(
            user_id, organization_id, content_type, content_id
        )
        if not role_can_edit(role):
            raise PermissionDeniedError("edit", "content")
