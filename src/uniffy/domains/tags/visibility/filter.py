"""Python-side tag visibility filter.

Thin facade over :func:`get_visible_tag_ids` for callers that already
hold a list of ``Tag`` rows in hand and need to drop the invisible
ones (e.g. search post-fetch trimming where the candidates come from
Meilisearch). The visible-set helper is cached in Valkey for 60s, so
this filter is effectively free after the first call per actor.

Public surface preserved for backwards compatibility with existing
search call sites; the implementation is no longer doing per-content
preloads.
"""

from collections.abc import Iterable
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.visible_sets import get_visible_tag_ids
from uniffy.core.models.tags.tag import Tag


class TagVisibilityFilter:
    """Filter a tag list down to rows the user is allowed to see.

    Resolves the actor's visible-set once via the cached helper and
    intersects against the input candidates. Org admins fall through
    with no filter (helper returns ``None``); everyone else gets the
    set membership check.
    """

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
        """Return the subset of ``tags`` the user can see, order preserved."""
        tag_list = list(tags)
        if not tag_list:
            return []
        visible = await get_visible_tag_ids(
            self.session,
            user_id=self.user_id,
            organization_id=self.organization_id,
        )
        if visible is None:
            return tag_list
        return [t for t in tag_list if t.id in visible]

    async def visible_id_set(self, tags: Iterable[Tag]) -> set[UUID]:
        """Return the set of tag ids visible to the user from ``tags``."""
        tag_list = list(tags)
        if not tag_list:
            return set()
        visible = await get_visible_tag_ids(
            self.session,
            user_id=self.user_id,
            organization_id=self.organization_id,
        )
        if visible is None:
            return {t.id for t in tag_list}
        return {t.id for t in tag_list if t.id in visible}

    async def is_visible(self, tag: Tag) -> bool:
        """Single-tag visibility check.

        Resolves the cached visible-set once and tests membership.
        Cheaper than the previous per-tag scan even on the first call
        because the cached set is shared with ``filter_visible`` /
        ``visible_id_set`` within the same request.
        """
        visible = await get_visible_tag_ids(
            self.session,
            user_id=self.user_id,
            organization_id=self.organization_id,
        )
        if visible is None:
            return True
        return tag.id in visible
