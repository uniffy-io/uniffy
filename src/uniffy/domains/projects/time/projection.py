"""Time record authority does not expose the referenced content's metadata."""

from collections.abc import Iterable
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.types import ContentType
from uniffy.domains.permissions.access import (
    MAX_RESOURCE_PAGE,
    ResourceAccessResolver,
    ResourceKey,
)


async def visible_content_ids(
    session: AsyncSession,
    actor_id: UUID,
    organization_id: UUID,
    content_type: ContentType,
    content_ids: Iterable[UUID],
) -> set[UUID]:
    keys = [ResourceKey(content_type, content_id) for content_id in set(content_ids)]
    resolver = ResourceAccessResolver(session)
    visible: set[UUID] = set()
    for start in range(0, len(keys), MAX_RESOURCE_PAGE):
        decisions = await resolver.resolve_page(
            actor_id=actor_id,
            organization_id=organization_id,
            keys=keys[start : start + MAX_RESOURCE_PAGE],
        )
        visible.update(key.content_id for key, decision in decisions.items() if decision.can_view)
    return visible
