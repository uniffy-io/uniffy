from collections.abc import Collection
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.visible_sets import compute_visible_tag_ids
from uniffy.core.models.tags.tag import Tag
from uniffy.core.types import ContentRole, ContentType
from uniffy.domains.permissions.access.subject import AccessSubject
from uniffy.domains.permissions.access.types import (
    ResourceAccessDecision,
    ResourceKey,
    ResourceRowState,
)


async def resolve_tags(
    session: AsyncSession,
    subject: AccessSubject,
    content_ids: Collection[UUID],
) -> dict[ResourceKey, ResourceAccessDecision]:
    if not content_ids:
        return {}
    rows = (
        await session.execute(
            select(Tag.id, Tag.created_by).where(
                Tag.organization_id == subject.organization_id,
                Tag.id.in_(content_ids),
            )
        )
    ).all()
    tags = {row.id: row for row in rows}
    visible_ids = (
        await compute_visible_tag_ids(
            session,
            user_id=subject.user_id,
            organization_id=subject.organization_id,
            candidate_tag_ids=tags,
        )
        if subject.is_active_member
        else set()
    )

    decisions: dict[ResourceKey, ResourceAccessDecision] = {}
    for content_id in content_ids:
        key = ResourceKey(ContentType.TAG, content_id)
        exists = content_id in tags
        can_view = exists and content_id in visible_ids
        decisions[key] = ResourceAccessDecision(
            key=key,
            row_state=ResourceRowState.LIVE if exists else ResourceRowState.MISSING,
            can_view=can_view,
            role=ContentRole.VIEWER if can_view else None,
        )
    return decisions
