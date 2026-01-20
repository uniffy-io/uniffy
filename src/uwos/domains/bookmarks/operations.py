"""Bookmark operations for toggling and listing user bookmarks.

This module handles all business logic for bookmarks including
toggle, list, and bulk check operations.
"""

from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uwos.core.models.bookmarks.bookmark import Bookmark


class BookmarksOperations:
    """
    Bookmark CRUD operations.

    Unlike content operations, bookmarks don't use BaseContentOperations
    because they are not content themselves - they're user preferences.
    """

    def __init__(self, session: AsyncSession) -> None:
        """
        Initialize bookmark operations.

        Parameters
        ----------
        session : AsyncSession
            SQLAlchemy async session for database operations.

        """
        self.session = session

    async def toggle(
        self,
        user_id: UUID,
        organization_id: UUID,
        urn: str,
    ) -> tuple[bool, Bookmark | None]:
        """
        Toggle bookmark state for a URN.

        If the URN is bookmarked, removes the bookmark.
        If the URN is not bookmarked, creates a bookmark.

        Parameters
        ----------
        user_id : UUID
            The user ID.
        organization_id : UUID
            The organization context.
        urn : str
            The URN to bookmark/unbookmark.

        Returns
        -------
        tuple[bool, Bookmark | None]
            (is_bookmarked, bookmark) - True and bookmark if now bookmarked,
            False and None if now unbookmarked.

        """
        existing = await self._get_bookmark(user_id, urn)

        if existing:
            # Remove bookmark
            await self.session.delete(existing)
            await self.session.commit()
            return (False, None)

        # Create bookmark
        bookmark = Bookmark(
            user_id=user_id,
            organization_id=organization_id,
            urn=urn,
        )
        self.session.add(bookmark)
        await self.session.commit()
        await self.session.refresh(bookmark)
        return (True, bookmark)

    async def list_bookmarks(
        self,
        user_id: UUID,
        organization_id: UUID,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[Bookmark], int]:
        """
        List user's bookmarks in an organization.

        Parameters
        ----------
        user_id : UUID
            The user ID.
        organization_id : UUID
            The organization context.
        page : int
            Page number (1-indexed).
        page_size : int
            Number of bookmarks per page.

        Returns
        -------
        tuple[list[Bookmark], int]
            (bookmarks, total_count) - List of bookmarks and total count.

        """
        base_query = select(Bookmark).where(
            and_(
                Bookmark.user_id == user_id,
                Bookmark.organization_id == organization_id,
            )
        )

        # Count total
        count_query = select(func.count()).select_from(base_query.subquery())
        total = (await self.session.execute(count_query)).scalar() or 0

        # Fetch paginated results ordered by most recent first
        query = base_query.order_by(Bookmark.created_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.session.execute(query)
        bookmarks = list(result.scalars().all())

        return (bookmarks, total)

    async def is_bookmarked(self, user_id: UUID, urn: str) -> bool:
        """
        Check if a URN is bookmarked by the user.

        Parameters
        ----------
        user_id : UUID
            The user ID.
        urn : str
            The URN to check.

        Returns
        -------
        bool
            True if bookmarked, False otherwise.

        """
        existing = await self._get_bookmark(user_id, urn)
        return existing is not None

    async def bulk_check(
        self,
        user_id: UUID,
        urns: list[str],
    ) -> dict[str, bool]:
        """
        Check multiple URNs for bookmark status.

        Parameters
        ----------
        user_id : UUID
            The user ID.
        urns : list[str]
            List of URNs to check.

        Returns
        -------
        dict[str, bool]
            Map of URN to bookmark status.

        """
        if not urns:
            return {}

        query = select(Bookmark.urn).where(
            and_(
                Bookmark.user_id == user_id,
                Bookmark.urn.in_(urns),
            )
        )
        result = await self.session.execute(query)
        bookmarked = set(result.scalars().all())

        return {urn: urn in bookmarked for urn in urns}

    async def _get_bookmark(self, user_id: UUID, urn: str) -> Bookmark | None:
        """
        Get a bookmark by user and URN.

        Parameters
        ----------
        user_id : UUID
            The user ID.
        urn : str
            The URN.

        Returns
        -------
        Bookmark | None
            The bookmark if found, None otherwise.

        """
        result = await self.session.execute(
            select(Bookmark).where(
                and_(
                    Bookmark.user_id == user_id,
                    Bookmark.urn == urn,
                )
            )
        )
        return result.scalars().first()
