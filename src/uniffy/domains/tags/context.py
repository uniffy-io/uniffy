"""Content-domain boundaries for tag assignment and hydration."""

from collections.abc import Iterable
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.tags.tag import Tag, TagAssignment
from uniffy.core.search.indexer import SearchIndexer
from uniffy.domains.tags.operations import (
    StagedManualTagReplacement,
    StagedTagRemoval,
    TagOperations,
)
from uniffy.domains.tags.reader import TagReader


class ContentTagReader:
    def __init__(self, session: AsyncSession) -> None:
        self.reader = TagReader(session)

    async def get_for_urns(
        self,
        *,
        organization_id: UUID,
        content_urns: Iterable[str],
    ) -> dict[str, list[Tag]]:
        return await self.reader.get_for_urns(
            organization_id=organization_id,
            content_urns=content_urns,
        )


class ContentTagMutations:
    def __init__(self, session: AsyncSession, search_indexer: SearchIndexer) -> None:
        self.operations = TagOperations(session, search_indexer)

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

    async def stage_unassign_all_for_urn(
        self,
        *,
        actor_id: UUID,
        organization_id: UUID,
        content_urn: str,
    ) -> StagedTagRemoval:
        return await self.operations.stage_unassign_all_for_urn(
            actor_id=actor_id,
            organization_id=organization_id,
            content_urn=content_urn,
        )

    async def finish_unassign_all_after_commit(self, staged: StagedTagRemoval) -> list[UUID]:
        return await self.operations.finish_unassign_all_after_commit(staged)


__all__ = [
    "ContentTagMutations",
    "ContentTagReader",
    "StagedManualTagReplacement",
    "StagedTagRemoval",
]
