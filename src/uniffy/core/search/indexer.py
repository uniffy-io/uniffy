"""Search indexing facade with durable write-ahead removals."""

import asyncio
from enum import StrEnum
from uuid import UUID

from loguru import logger

from uniffy.core.search.engine import SearchFilter, search_filter_to_data
from uniffy.core.search.policy import (
    SearchContainerAccess,
    SearchDocumentInput,
    build_search_document,
)
from uniffy.core.search.workspace import WorkspaceSearch
from uniffy.core.types import AccessMode, ContentRole, ContentType

logger = logger.bind(component="search.indexer")

SEARCH_INDEXER_CTX_KEY = "search_indexer"
_RETRY_DELAYS_SECONDS = (1, 5, 15, 60, 120)
_retry_tasks: set[asyncio.Task] = set()


async def _record_pending_removal(
    urn: str | None = None,
    filter_spec: SearchFilter | None = None,
    organization_id: UUID | None = None,
) -> UUID | None:
    from uniffy.core.models.search import SearchRemovalQueue
    from uniffy.infrastructure.database import open_session

    row = SearchRemovalQueue(
        urn=urn,
        filter_spec=(search_filter_to_data(filter_spec) if filter_spec is not None else None),
        organization_id=organization_id,
    )
    try:
        async with open_session() as session:
            session.add(row)
            await session.commit()
        return row.id
    except Exception:
        logger.warning("Failed to record search removal; retrying in background", urn=urn)
        task = asyncio.create_task(_record_removal_with_retry(urn, filter_spec, organization_id))
        _retry_tasks.add(task)
        task.add_done_callback(_retry_tasks.discard)
        return None


async def _record_removal_with_retry(
    urn: str | None,
    filter_spec: SearchFilter | None,
    organization_id: UUID | None,
) -> None:
    from uniffy.core.models.search import SearchRemovalQueue
    from uniffy.infrastructure.database import open_session

    serialized_filter = search_filter_to_data(filter_spec) if filter_spec is not None else None
    for delay in _RETRY_DELAYS_SECONDS:
        await asyncio.sleep(delay)
        try:
            async with open_session() as session:
                session.add(
                    SearchRemovalQueue(
                        urn=urn,
                        filter_spec=serialized_filter,
                        organization_id=organization_id,
                    )
                )
                await session.commit()
            logger.info("Recorded search removal after retry", urn=urn)
            return
        except Exception:
            continue
    logger.error(
        "Giving up recording search removal after retries",
        urn=urn,
        retries=len(_RETRY_DELAYS_SECONDS),
    )


async def _clear_pending_removal(row_id: UUID) -> None:
    from sqlalchemy import delete as sa_delete

    from uniffy.core.models.search import SearchRemovalQueue
    from uniffy.infrastructure.database import open_session

    try:
        async with open_session() as session:
            await session.execute(
                sa_delete(SearchRemovalQueue).where(SearchRemovalQueue.id == row_id)
            )
            await session.commit()
    except Exception:
        logger.warning("Failed to clear completed search removal row", row_id=str(row_id))


RANK_SCORE_BY_ENTITY_TYPE: dict[str, float] = {
    "note": 1.0,
    "project": 1.0,
    "task": 0.9,
    "file": 0.9,
    "folder": 0.9,
    "calendar_event": 0.9,
    "chat": 0.9,
    "agent_chat": 0.8,
    "agent_folder": 0.8,
    "room": 0.8,
    "calendar": 0.8,
    "agent": 0.8,
    "user": 0.8,
    "team": 0.8,
    "agent_cron_task": 0.7,
    "tag": 0.6,
    "chat_message": 0.3,
}

_FALLBACK_RANK_SCORE = 0.8


def default_rank_score(entity_type: str) -> float:
    return RANK_SCORE_BY_ENTITY_TYPE.get(entity_type.lower(), _FALLBACK_RANK_SCORE)


def _value(value: StrEnum | str | None) -> str | None:
    return value.value if isinstance(value, StrEnum) else value


class SearchIndexer:
    def __init__(self, search: WorkspaceSearch) -> None:
        self.search = search

    async def index(
        self,
        urn: str,
        organization_id: UUID,
        title: str,
        entity_type: str,
        url_path: str,
        owner_id: UUID,
        access_mode: AccessMode | str,
        baseline_role: ContentRole | str | None,
        keywords: str | None = None,
        description: str | None = None,
        shared_user_ids: list[UUID] | None = None,
        shared_group_ids: list[UUID] | None = None,
        blocked_user_ids: list[UUID] | None = None,
        blocked_group_ids: list[UUID] | None = None,
        attendee_user_ids: list[UUID] | None = None,
        container: SearchContainerAccess | None = None,
        tags: list[str] | None = None,
        rank_score: float | None = None,
        metadata: dict[str, str] | None = None,
    ) -> None:
        await self.search.index_document(
            SearchDocumentInput(
                urn=urn,
                organization_id=organization_id,
                title=title,
                entity_type=entity_type,
                url_path=url_path,
                owner_id=owner_id,
                access_mode=_value(access_mode) or AccessMode.OWNER_ONLY.value,
                baseline_role=_value(baseline_role),
                content=keywords,
                description=description,
                shared_user_ids=tuple(shared_user_ids or ()),
                shared_group_ids=tuple(shared_group_ids or ()),
                blocked_user_ids=tuple(blocked_user_ids or ()),
                blocked_group_ids=tuple(blocked_group_ids or ()),
                attendee_user_ids=tuple(attendee_user_ids or ()),
                container=container,
                tags=tuple(tags or ()),
                rank_score=(
                    rank_score if rank_score is not None else default_rank_score(entity_type)
                ),
                metadata=metadata,
            )
        )

    async def batch_index(self, items: list[dict]) -> None:
        documents = []
        for item in items:
            entity_type = str(item.get("entity_type", "")).lower()
            documents.append(
                build_search_document(
                    SearchDocumentInput(
                        urn=item["urn"],
                        organization_id=item["organization_id"],
                        title=item.get("title", ""),
                        entity_type=entity_type,
                        url_path=item.get("url_path", ""),
                        owner_id=item["owner_id"],
                        access_mode=(_value(item.get("access_mode")) or AccessMode.OWNER_ONLY.value),
                        baseline_role=_value(item.get("baseline_role")),
                        content=item.get("keywords"),
                        description=item.get("description"),
                        shared_user_ids=tuple(item.get("shared_user_ids") or ()),
                        shared_group_ids=tuple(item.get("shared_group_ids") or ()),
                        blocked_user_ids=tuple(item.get("blocked_user_ids") or ()),
                        blocked_group_ids=tuple(item.get("blocked_group_ids") or ()),
                        attendee_user_ids=tuple(item.get("attendee_user_ids") or ()),
                        tags=tuple(item.get("tags") or ()),
                        rank_score=item.get("rank_score") or default_rank_score(entity_type),
                        metadata=item.get("metadata"),
                    )
                )
            )
        await self.search.batch_index_documents(documents)

    async def update_sharing(
        self,
        urn: str,
        organization_id: UUID,
        shared_user_ids: list[UUID],
        shared_group_ids: list[UUID],
        blocked_user_ids: list[UUID] | None = None,
        blocked_group_ids: list[UUID] | None = None,
    ) -> None:
        await self.search.update_document_sharing(
            urn,
            organization_id,
            shared_user_ids,
            shared_group_ids,
            blocked_user_ids,
            blocked_group_ids,
        )

    async def update_attendees(
        self,
        urn: str,
        organization_id: UUID,
        attendee_user_ids: list[UUID],
    ) -> None:
        await self.search.update_document_attendees(urn, organization_id, attendee_user_ids)

    async def update_container_access(
        self,
        document_ids: list[str],
        container: SearchContainerAccess,
    ) -> int:
        return await self.search.update_container_access(document_ids, container)

    async def update_access_policy(
        self,
        urn: str,
        organization_id: UUID,
        access_mode: AccessMode,
        baseline_role: ContentRole | None,
        owner_id: UUID,
    ) -> None:
        await self.search.update_document_access_policy(
            urn,
            organization_id,
            access_mode.value,
            baseline_role.value if baseline_role else None,
            owner_id,
        )

    async def update_access_policy_bulk(
        self,
        organization_id: UUID,
        items: list[tuple[str, AccessMode, ContentRole | None]],
    ) -> int:
        return await self.search.update_document_access_policy_bulk(
            organization_id,
            [
                (urn, access_mode.value, baseline_role.value if baseline_role else None)
                for urn, access_mode, baseline_role in items
            ],
        )

    async def update_tags_for_urn(
        self,
        urn: str,
        organization_id: UUID,
        tags: list[str],
    ) -> None:
        await self.search.update_document_tags(urn, organization_id, tags)

    async def update_tags_bulk(
        self,
        organization_id: UUID,
        items: list[tuple[str, list[str]]],
    ) -> None:
        await self.search.update_document_tags_bulk(organization_id, items)

    async def remove(
        self,
        urn: str,
        organization_id: UUID | None = None,
    ) -> None:
        row_id = await _record_pending_removal(urn=urn, organization_id=organization_id)
        try:
            await self.search.delete_document(urn, organization_id)
        except Exception:
            logger.warning("Inline search removal failed; queued for retry", urn=urn)
            return
        if row_id is not None:
            await _clear_pending_removal(row_id)

    async def remove_by_filter(self, expression: SearchFilter) -> None:
        row_id = await _record_pending_removal(filter_spec=expression)
        try:
            await self.search.delete_documents(expression)
        except Exception:
            logger.warning("Inline search filter removal failed; queued for retry")
            return
        if row_id is not None:
            await _clear_pending_removal(row_id)

    async def remove_by_content(
        self,
        content_type: ContentType,
        content_id: UUID,
        organization_id: UUID | None = None,
    ) -> None:
        await self.remove(build_content_urn(content_type, content_id), organization_id)


def build_content_urn(content_type: ContentType, content_id: UUID) -> str:
    return f"urn:uniffy:content:{content_type.value}:{content_id}"
