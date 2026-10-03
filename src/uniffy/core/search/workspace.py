"""Uniffy search behavior composed over a vendor-neutral engine."""

import asyncio
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from loguru import logger

from uniffy.core.content.references import parse_urn
from uniffy.core.search.engine import (
    SearchEngine,
    SearchFilter,
    SearchPage,
    SearchQuery,
    SearchSort,
    SearchTerm,
    all_of,
    any_of,
)
from uniffy.core.search.policy import (
    HIGHLIGHT_POST_TAG,
    HIGHLIGHT_PRE_TAG,
    SEARCH_HIT_FIELDS,
    WORKSPACE_SEARCH_SCHEMA,
    SearchCandidateScope,
    SearchContainerAccess,
    SearchDocumentInput,
    build_candidate_filter,
    build_document_id,
    build_search_document,
    container_fields,
)

logger = logger.bind(component="search.workspace")

WORKSPACE_SEARCH_CTX_KEY = "workspace_search"


@dataclass(frozen=True, slots=True)
class DocumentLookupResult:
    documents: dict[str, dict[str, Any]]
    failed_urns: frozenset[str]

    @property
    def complete(self) -> bool:
        return not self.failed_urns


class WorkspaceSearch:
    """Application search policy independent of the selected search engine."""

    def __init__(self, engine: SearchEngine) -> None:
        self.engine = engine

    async def startup(self) -> None:
        await self.engine.startup(WORKSPACE_SEARCH_SCHEMA)

    async def shutdown(self) -> None:
        await self.engine.shutdown()

    async def index_document(self, item: SearchDocumentInput) -> None:
        await self.engine.put_documents([build_search_document(item)])

    async def batch_index_documents(self, documents: list[dict[str, Any]]) -> None:
        if documents:
            await self.engine.put_documents(documents)

    async def delete_document(
        self,
        urn: str,
        organization_id: UUID | None = None,
    ) -> None:
        if organization_id is not None:
            await self.engine.delete_document(build_document_id(urn, organization_id))
            return
        await self.engine.delete_by_filter(SearchTerm("urn", urn))

    async def delete_documents(self, expression: SearchFilter) -> None:
        await self.engine.delete_by_filter(expression)

    async def search(
        self,
        query: str,
        organization_id: UUID,
        user_id: UUID,
        user_group_ids: list[UUID] | None = None,
        type_filters: list[str] | None = None,
        tag_filters: list[str] | None = None,
        my_content_only: bool = False,
        owner_filter: UUID | None = None,
        metadata_filters: dict[str, str] | None = None,
        limit: int = 20,
        offset: int = 0,
        attributes_to_search_on: list[str] | None = None,
        candidate_scope: SearchCandidateScope = SearchCandidateScope.MEMBER_HINT,
    ) -> SearchPage:
        expression = build_candidate_filter(
            organization_id=organization_id,
            user_id=user_id,
            user_group_ids=tuple(user_group_ids or ()),
            type_filters=tuple(type_filters or ()),
            tag_filters=tuple(tag_filters or ()),
            my_content_only=my_content_only,
            owner_filter=owner_filter,
            metadata_filters=metadata_filters,
            candidate_scope=candidate_scope,
        )
        return await self.engine.search(
            SearchQuery(
                text=query or None,
                filter=expression,
                limit=limit,
                offset=offset,
                sort=(
                    SearchSort("rank_score", descending=True),
                    SearchSort("updated_at", descending=True),
                ),
                retrieve_fields=SEARCH_HIT_FIELDS,
                search_fields=(tuple(attributes_to_search_on) if attributes_to_search_on else None),
                highlight_fields=("title", "description"),
                highlight_pre_tag=HIGHLIGHT_PRE_TAG,
                highlight_post_tag=HIGHLIGHT_POST_TAG,
                crop_fields=("description",),
                crop_length=20,
                crop_marker="…",
                include_score=True,
            )
        )

    async def update_document_sharing(
        self,
        urn: str,
        organization_id: UUID,
        shared_user_ids: list[UUID],
        shared_group_ids: list[UUID],
        blocked_user_ids: list[UUID] | None = None,
        blocked_group_ids: list[UUID] | None = None,
    ) -> None:
        await self.engine.patch_documents([
            {
                "id": build_document_id(urn, organization_id),
                "shared_user_ids": [str(value) for value in shared_user_ids],
                "shared_group_ids": [str(value) for value in shared_group_ids],
                "blocked_user_ids": [str(value) for value in blocked_user_ids or ()],
                "blocked_group_ids": [str(value) for value in blocked_group_ids or ()],
            }
        ])

    async def update_chat_message_sharing(
        self,
        *,
        organization_id: UUID,
        channel_id: UUID,
        shared_user_ids: list[UUID],
        access_mode: str,
        baseline_role: str | None,
    ) -> int:
        """Historical public documents need policy fields refreshed as well as membership."""
        # Meilisearch keeps an omitted key untouched, so a None baseline has to
        # be written explicitly or OPEN_TO_ORG's VIEWER would survive.
        patch: dict[str, Any] = {
            "shared_user_ids": [str(value) for value in shared_user_ids],
            "access_mode": access_mode,
            "baseline_role": baseline_role,
        }
        return await self._patch_matching(
            all_of(
                SearchTerm("organization_id", str(organization_id)),
                SearchTerm("entity_type", "chat_message"),
                SearchTerm("metadata.channel_id", str(channel_id)),
            ),
            patch,
        )

    async def update_task_sharing(
        self,
        *,
        organization_id: UUID,
        project_id: UUID,
        owner_id: UUID,
        access_mode: str,
        baseline_role: str | None,
        shared_user_ids: list[UUID],
        shared_group_ids: list[UUID],
        blocked_user_ids: list[UUID],
        blocked_group_ids: list[UUID],
    ) -> int:
        return await self._patch_matching(
            all_of(
                SearchTerm("organization_id", str(organization_id)),
                SearchTerm("entity_type", "task"),
                SearchTerm("metadata.project_id", str(project_id)),
            ),
            {
                "owner_id": str(owner_id),
                "access_mode": access_mode,
                "baseline_role": baseline_role,
                "shared_user_ids": [str(value) for value in shared_user_ids],
                "shared_group_ids": [str(value) for value in shared_group_ids],
                "blocked_user_ids": [str(value) for value in blocked_user_ids],
                "blocked_group_ids": [str(value) for value in blocked_group_ids],
            },
        )

    async def update_container_access(
        self,
        document_ids: list[str],
        container: SearchContainerAccess,
    ) -> int:
        """Patch known documents by id; one not indexed yet gets the fields when it is."""
        if not document_ids:
            return 0
        changes = container_fields(container)
        await self.engine.patch_documents(
            [{"id": document_id, **changes} for document_id in document_ids],
            create_missing=False,
            wait=True,
        )
        return len(document_ids)

    async def _patch_matching(
        self,
        expression: SearchFilter,
        changes: dict[str, Any],
    ) -> int:
        batch_size = 500
        offset = 0
        updated = 0
        while True:
            page = await self.engine.fetch_documents(
                expression,
                fields=("id",),
                limit=batch_size,
                offset=offset,
            )
            partials = [{"id": row["id"], **changes} for row in page.documents if row.get("id")]
            if partials:
                await self.engine.patch_documents(
                    partials,
                    create_missing=False,
                    wait=True,
                )
                updated += len(partials)
            if len(page.documents) < batch_size:
                return updated
            offset += len(page.documents)

    async def update_document_attendees(
        self,
        urn: str,
        organization_id: UUID,
        attendee_user_ids: list[UUID],
    ) -> None:
        await self.engine.patch_documents([
            {
                "id": build_document_id(urn, organization_id),
                "attendee_user_ids": [str(value) for value in attendee_user_ids],
            }
        ])

    async def update_document_access_policy(
        self,
        urn: str,
        organization_id: UUID,
        access_mode: str,
        baseline_role: str | None,
        owner_id: UUID,
    ) -> None:
        await self.engine.patch_documents([
            {
                "id": build_document_id(urn, organization_id),
                "access_mode": access_mode,
                "baseline_role": baseline_role,
                "owner_id": str(owner_id),
            }
        ])

    async def update_document_access_policy_bulk(
        self,
        organization_id: UUID,
        items: list[tuple[str, str, str | None]],
    ) -> int:
        if not items:
            return 0
        partials = [
            {
                "id": build_document_id(urn, organization_id),
                "access_mode": access_mode,
                "baseline_role": baseline_role,
            }
            for urn, access_mode, baseline_role in items
        ]
        await self.engine.patch_documents(partials, create_missing=False, wait=True)
        return len(partials)

    async def update_document_tags(
        self,
        urn: str,
        organization_id: UUID,
        tags: list[str],
    ) -> None:
        await self.engine.patch_documents([
            {"id": build_document_id(urn, organization_id), "tags": tags}
        ])

    async def update_document_tags_bulk(
        self,
        organization_id: UUID,
        items: list[tuple[str, list[str]]],
    ) -> None:
        if items:
            await self.engine.patch_documents([
                {"id": build_document_id(urn, organization_id), "tags": tags} for urn, tags in items
            ])

    async def get_documents_by_urns(
        self,
        urns: list[str],
        organization_id: UUID,
    ) -> DocumentLookupResult:
        valid_urns = [urn for urn in urns if parse_urn(urn) is not None]
        if not valid_urns:
            return DocumentLookupResult(documents={}, failed_urns=frozenset())

        async def load_chunk(
            chunk: list[str],
        ) -> tuple[dict[str, dict[str, Any]], set[str]]:
            expression = all_of(
                any_of(*(SearchTerm("urn", urn) for urn in chunk)),
                SearchTerm("organization_id", str(organization_id)),
            )
            try:
                page = await self.engine.fetch_documents(expression, limit=len(chunk))
            except Exception:
                logger.opt(exception=True).warning(
                    "Search document lookup chunk failed",
                    chunk_size=len(chunk),
                )
                return {}, set(chunk)
            return {
                document["urn"]: document for document in page.documents if document.get("urn")
            }, set()

        result: dict[str, dict[str, Any]] = {}
        failed_urns: set[str] = set()
        chunk_size = 50
        chunks = [
            valid_urns[index : index + chunk_size] for index in range(0, len(valid_urns), chunk_size)
        ]
        for documents, failures in await asyncio.gather(*(load_chunk(chunk) for chunk in chunks)):
            result.update(documents)
            failed_urns.update(failures)
        return DocumentLookupResult(result, frozenset(failed_urns))

    async def health_check(self) -> bool:
        return await self.engine.health()
