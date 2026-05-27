"""Bookmark CRUD: toggle, list, bulk check."""

from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.bookmarks.bookmark import Bookmark


class BookmarksOperations:
    """Bookmark CRUD. Bookmarks are user preferences, not content."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def toggle(
        self,
        user_id: UUID,
        organization_id: UUID,
        urn: str,
    ) -> tuple[bool, Bookmark | None]:
        """Toggle bookmark state; returns `(is_bookmarked, bookmark)`."""
        existing = await self._get_bookmark(user_id, urn)

        if existing:
            await self.session.delete(existing)
            await self.session.commit()
            return (False, None)

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
        """List the user's bookmarks in an organization, newest first."""
        base_query = select(Bookmark).where(
            and_(
                Bookmark.user_id == user_id,
                Bookmark.organization_id == organization_id,
            )
        )

        count_query = select(func.count()).select_from(base_query.subquery())
        total = (await self.session.execute(count_query)).scalar() or 0

        query = base_query.order_by(Bookmark.created_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.session.execute(query)
        bookmarks = list(result.scalars().all())

        return (bookmarks, total)

    async def is_bookmarked(self, user_id: UUID, urn: str) -> bool:
        existing = await self._get_bookmark(user_id, urn)
        return existing is not None

    async def bulk_check(
        self,
        user_id: UUID,
        urns: list[str],
    ) -> dict[str, bool]:
        """Return a `{urn: is_bookmarked}` map for the given URNs."""
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
        result = await self.session.execute(
            select(Bookmark).where(
                and_(
                    Bookmark.user_id == user_id,
                    Bookmark.urn == urn,
                )
            )
        )
        return result.scalars().first()
