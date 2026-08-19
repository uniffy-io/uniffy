"""Candidate-bounded PostgreSQL visibility checks for ``Tag`` rows."""

from collections.abc import Iterable
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.visible_sets import compute_visible_tag_ids
from uniffy.core.models.tags.tag import Tag


class TagVisibilityFilter:
    def __init__(
        self,
        session: AsyncSession,
        user_id: UUID,
        organization_id: UUID,
    ) -> None:
        self.session = session
        self.user_id = user_id
        self.organization_id = organization_id

    async def filter_visible(self, tags: Iterable[Tag]) -> list[Tag]:
        """Order-preserving."""
        tag_list = list(tags)
        if not tag_list:
            return []
        visible = await compute_visible_tag_ids(
            self.session,
            user_id=self.user_id,
            organization_id=self.organization_id,
            candidate_tag_ids={tag.id for tag in tag_list},
        )
        return [t for t in tag_list if t.id in visible]

    async def visible_id_set(self, tags: Iterable[Tag]) -> set[UUID]:
        tag_list = list(tags)
        if not tag_list:
            return set()
        visible = await compute_visible_tag_ids(
            self.session,
            user_id=self.user_id,
            organization_id=self.organization_id,
            candidate_tag_ids={tag.id for tag in tag_list},
        )
        return {t.id for t in tag_list if t.id in visible}

    async def is_visible(self, tag: Tag) -> bool:
        visible = await compute_visible_tag_ids(
            self.session,
            user_id=self.user_id,
            organization_id=self.organization_id,
            candidate_tag_ids={tag.id},
        )
        return tag.id in visible
