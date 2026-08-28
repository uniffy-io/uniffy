"""Content-domain boundary for tag assignment and hydration."""

from collections.abc import Iterable
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.tags.tag import Tag, TagAssignment
from uniffy.domains.tags.operations import StagedManualTagReplacement, TagOperations


class ContentTagContext:
    def __init__(self, session: AsyncSession) -> None:
        self.operations = TagOperations(session)

    async def get_for_urns(
        self,
        *,
        organization_id: UUID,
        content_urns: Iterable[str],
    ) -> dict[str, list[Tag]]:
        return await self.operations.get_for_urns(
            organization_id=organization_id,
            content_urns=content_urns,
        )

    async def stage_manual_tags(
        self,
        *,
        actor_id: UUID,
        organization_id: UUID,
        content_urn: str,
        tag_ids: Iterable[UUID],
    ) -> StagedManualTagReplacement:
        return await self.operations.stage_manual_tags(
            actor_id=actor_id,
            organization_id=organization_id,
            content_urn=content_urn,
            tag_ids=tag_ids,
        )

    async def finish_manual_tags_after_commit(
        self,
        staged: StagedManualTagReplacement,
    ) -> list[TagAssignment]:
        return await self.operations.finish_manual_tags_after_commit(staged)

    async def replace_manual_tags(
        self,
        *,
        actor_id: UUID,
        organization_id: UUID,
        content_urn: str,
        tag_ids: Iterable[UUID],
    ) -> list[TagAssignment]:
        return await self.operations.replace_manual_tags(
            actor_id=actor_id,
            organization_id=organization_id,
            content_urn=content_urn,
            tag_ids=tag_ids,
        )

    async def unassign_all_for_urn(
        self,
        *,
        actor_id: UUID,
        organization_id: UUID,
        content_urn: str,
    ) -> list[UUID]:
        return await self.operations.unassign_all_for_urn(
            actor_id=actor_id,
            organization_id=organization_id,
            content_urn=content_urn,
        )


__all__ = ["ContentTagContext", "StagedManualTagReplacement"]
