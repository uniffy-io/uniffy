"""Async Meilisearch client wrapper."""

import os
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from loguru import logger
from meilisearch_python_sdk import AsyncClient
from meilisearch_python_sdk.models.search import SearchResults
from meilisearch_python_sdk.models.settings import (
    Faceting,
    MeilisearchSettings,
    MinWordSizeForTypos,
    Pagination,
    TypoTolerance,
)

from uniffy.observability.metrics import (
    SEARCH_OPERATION_DURATION,
    SEARCH_OPERATION_ERRORS_TOTAL,
    SEARCH_OPERATIONS_TOTAL,
)

UNIFFY_INDEX_NAME = "uniffy"


@dataclass
class MeilisearchConfig:
    """Meilisearch connection configuration."""

    url: str
    master_key: str
    index_name: str = UNIFFY_INDEX_NAME
    timeout: int = 30

    @classmethod
    def from_env(cls) -> MeilisearchConfig:
        """Read ``MEILISEARCH_URL`` / ``_MASTER_KEY`` / ``_INDEX_NAME`` / ``_TIMEOUT``."""
        return cls(
            url=os.getenv("MEILISEARCH_URL", "http://localhost:7700"),
            master_key=os.getenv("MEILISEARCH_MASTER_KEY", "uniffy-dev-master-key"),
            index_name=os.getenv("MEILISEARCH_INDEX_NAME", UNIFFY_INDEX_NAME),
            timeout=int(os.getenv("MEILISEARCH_TIMEOUT", "30")),
        )


INDEX_SETTINGS = MeilisearchSettings(
    searchable_attributes=[
        "title",
        "content",
        "tags",
        "description",
    ],
    filterable_attributes=[
        "urn",
        "organization_id",
        "entity_type",
        "access_mode",
        "baseline_role",
        "owner_id",
        "shared_user_ids",
        "shared_group_ids",
        "blocked_user_ids",
        "blocked_group_ids",
        "tags",
        "updated_at",
        "metadata.channel_id",
        "metadata.sender_id",
        "metadata.project_id",
        "metadata.folder_id",
    ],
    sortable_attributes=[
        "updated_at",
        "rank_score",
        "title",
    ],
    ranking_rules=[
        "words",
        "typo",
        "proximity",
        "attribute",
        "sort",
        "exactness",
    ],
    typo_tolerance=TypoTolerance(
        enabled=True,
        min_word_size_for_typos=MinWordSizeForTypos(
            one_typo=4,
            two_typos=8,
        ),
    ),
    faceting=Faceting(max_values_per_facet=100),
    pagination=Pagination(max_total_hits=1000),
)


def build_document_id(urn: str, organization_id: UUID) -> str:
    """Build a Meilisearch document id ``{safe_urn}__{organization_id}``.

    Meilisearch document ids only allow alphanumerics, hyphens, and underscores,
    so colons in the URN are replaced with hyphens.
    """
    safe_urn = urn.replace(":", "-")
    return f"{safe_urn}__{organization_id}"


def parse_document_id(doc_id: str) -> tuple[str, str]:
    """Inverse of :func:`build_document_id`."""
    parts = doc_id.rsplit("__", 1)
    if len(parts) != 2:
        raise ValueError(f"Invalid document ID format: {doc_id}")
    safe_urn, org_id = parts
    urn = safe_urn.replace("urn-uniffy-content-", "urn:uniffy:content:", 1)
    return urn, org_id


class MeilisearchClient:
    """Async Meilisearch client; multi-tenancy enforced via ``organization_id`` filtering."""

    def __init__(self, config: MeilisearchConfig | None = None) -> None:
        self.config = config or MeilisearchConfig.from_env()
        self._client: AsyncClient | None = None

    async def __aenter__(self) -> MeilisearchClient:
        self._client = AsyncClient(
            self.config.url,
            self.config.master_key,
            timeout=self.config.timeout,
        )
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None

    @property
    def client(self) -> AsyncClient:
        if self._client is None:
            raise RuntimeError(
                "MeilisearchClient not initialized. Use 'async with' context manager."
            )
        return self._client

    async def ensure_index(self) -> None:
        """Create the index if missing, then apply ``INDEX_SETTINGS``."""
        start = time.perf_counter()
        try:
            index = await self.client.get_index(self.config.index_name)
            elapsed_ms = (time.perf_counter() - start) * 1000
            logger.info(
                f"Meilisearch: get_index '{self.config.index_name}' (exists)",
                ms=f"{elapsed_ms:.1f}",
            )
        except Exception:
            index = await self.client.create_index(
                self.config.index_name,
                primary_key="id",
                settings=INDEX_SETTINGS,
            )
            elapsed_ms = (time.perf_counter() - start) * 1000
            logger.info(
                f"Meilisearch: create_index '{self.config.index_name}'",
                ms=f"{elapsed_ms:.1f}",
            )
            return

        settings_start = time.perf_counter()
        await index.update_settings(INDEX_SETTINGS)
        elapsed_ms = (time.perf_counter() - settings_start) * 1000
        logger.info(
            f"Meilisearch: update_settings '{self.config.index_name}'",
            ms=f"{elapsed_ms:.1f}",
        )

    async def index_document(
        self,
        urn: str,
        organization_id: UUID,
        title: str,
        entity_type: str,
        url_path: str,
        owner_id: UUID,
        access_mode: str,
        baseline_role: str | None,
        content: str | None = None,
        description: str | None = None,
        shared_user_ids: list[UUID] | None = None,
        shared_group_ids: list[UUID] | None = None,
        blocked_user_ids: list[UUID] | None = None,
        blocked_group_ids: list[UUID] | None = None,
        tags: list[str] | None = None,
        rank_score: float = 1.0,
        metadata: dict[str, str] | None = None,
    ) -> None:
        """Index or update one document."""
        doc_id = build_document_id(urn, organization_id)

        document = {
            "id": doc_id,
            "urn": urn,
            "organization_id": str(organization_id),
            "title": title,
            "content": content or "",
            "description": description or "",
            "entity_type": entity_type,
            "url_path": url_path,
            "access_mode": access_mode,
            "baseline_role": baseline_role,
            "owner_id": str(owner_id),
            "shared_user_ids": [str(uid) for uid in (shared_user_ids or [])],
            "shared_group_ids": [str(gid) for gid in (shared_group_ids or [])],
            "blocked_user_ids": [str(uid) for uid in (blocked_user_ids or [])],
            "blocked_group_ids": [str(gid) for gid in (blocked_group_ids or [])],
            "tags": tags or [],
            "rank_score": rank_score,
            "metadata": metadata or {},
            "updated_at": int(datetime.now(UTC).timestamp()),
        }

        start = time.perf_counter()
        index = self.client.index(self.config.index_name)
        await index.add_documents([document])
        elapsed_ms = (time.perf_counter() - start) * 1000
        SEARCH_OPERATIONS_TOTAL.labels(operation="index").inc()
        SEARCH_OPERATION_DURATION.labels(operation="index").observe(elapsed_ms / 1000)
        logger.info(
            f"Meilisearch: index_document type={entity_type}",
            ms=f"{elapsed_ms:.1f}",
            urn=urn,
        )

    async def batch_index_documents(
        self,
        documents: list[dict[str, Any]],
    ) -> None:
        """Index multiple documents in one call; each must carry an ``id``
        from :func:`build_document_id`.
        """
        if not documents:
            return

        start = time.perf_counter()
        index = self.client.index(self.config.index_name)
        await index.add_documents(documents)
        elapsed_ms = (time.perf_counter() - start) * 1000
        SEARCH_OPERATIONS_TOTAL.labels(operation="index").inc(len(documents))
        SEARCH_OPERATION_DURATION.labels(operation="index").observe(elapsed_ms / 1000)
        logger.info(
            f"Meilisearch: batch_index count={len(documents)}",
            ms=f"{elapsed_ms:.1f}",
        )

    async def delete_document(
        self,
        urn: str,
        organization_id: UUID | None = None,
    ) -> None:
        """Delete by URN and wait for the task; without the wait the doc
        stays searchable for a few hundred ms.
        """
        start = time.perf_counter()
        index = self.client.index(self.config.index_name)

        if organization_id:
            doc_id = build_document_id(urn, organization_id)
            task = await index.delete_document(doc_id)
            await self._await_task(task)
            elapsed_ms = (time.perf_counter() - start) * 1000
            SEARCH_OPERATIONS_TOTAL.labels(operation="delete").inc()
            SEARCH_OPERATION_DURATION.labels(operation="delete").observe(elapsed_ms / 1000)
            logger.info(
                "Meilisearch: delete_document",
                ms=f"{elapsed_ms:.1f}",
                urn=urn,
            )
        else:
            task = await index.delete_documents_by_filter(f'urn = "{urn}"')
            await self._await_task(task)
            elapsed_ms = (time.perf_counter() - start) * 1000
            SEARCH_OPERATIONS_TOTAL.labels(operation="delete").inc()
            SEARCH_OPERATION_DURATION.labels(operation="delete").observe(elapsed_ms / 1000)
            logger.info(
                "Meilisearch: delete_documents_by_filter",
                ms=f"{elapsed_ms:.1f}",
                urn=urn,
            )

    async def _await_task(self, task: object | None) -> None:
        """Block until a Meilisearch task settles; errors are swallowed (DB row is already gone)."""
        if task is None:
            return
        task_uid = getattr(task, "task_uid", None) or getattr(task, "taskUid", None)
        if task_uid is None:
            return
        try:
            await self.client.wait_for_task(task_uid, timeout_in_ms=5000)
        except Exception:
            logger.warning("Meilisearch: wait_for_task failed", task_uid=task_uid)

    async def delete_documents_by_filter_expr(self, filter_expr: str) -> None:
        """Delete every document matching ``filter_expr`` (filterable attributes only)."""
        start = time.perf_counter()
        index = self.client.index(self.config.index_name)
        try:
            task = await index.delete_documents_by_filter(filter_expr)
            await self._await_task(task)
        except Exception:
            logger.warning(
                "Meilisearch: delete_documents_by_filter_expr failed",
                filter=filter_expr,
                exc_info=True,
            )
            return
        elapsed_ms = (time.perf_counter() - start) * 1000
        SEARCH_OPERATIONS_TOTAL.labels(operation="delete").inc()
        SEARCH_OPERATION_DURATION.labels(operation="delete").observe(elapsed_ms / 1000)
        logger.info(
            "Meilisearch: delete_documents_by_filter_expr",
            ms=f"{elapsed_ms:.1f}",
            filter=filter_expr,
        )

    async def search(
        self,
        query: str,
        organization_id: UUID,
        user_id: UUID,
        user_group_ids: list[UUID] | None = None,
        type_filters: list[str] | None = None,
        exclude_type_filters: list[str] | None = None,
        tag_filters: list[str] | None = None,
        my_content_only: bool = False,
        owner_filter: UUID | None = None,
        metadata_filters: dict[str, str] | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> SearchResults:
        """Search with permission filtering applied as a Meilisearch filter expression."""
        index = self.client.index(self.config.index_name)

        filters = self._build_permission_filter(
            organization_id=organization_id,
            user_id=user_id,
            user_group_ids=user_group_ids,
            my_content_only=my_content_only,
            owner_filter=owner_filter,
        )

        if type_filters:
            type_filter = " OR ".join(f'entity_type = "{t}"' for t in type_filters)
            filters = f"({filters}) AND ({type_filter})"

        if exclude_type_filters:
            exclude_filter = " AND ".join(f'entity_type != "{t}"' for t in exclude_type_filters)
            filters = f"({filters}) AND ({exclude_filter})"

        if tag_filters:
            tag_conditions = " AND ".join(f'tags = "{tag}"' for tag in tag_filters)
            filters = f"({filters}) AND ({tag_conditions})"

        if metadata_filters:
            meta_conditions = " AND ".join(
                f'metadata.{key} = "{value}"' for key, value in metadata_filters.items()
            )
            filters = f"({filters}) AND ({meta_conditions})"

        start = time.perf_counter()
        results = await index.search(
            query=query if query else None,
            filter=filters,
            limit=limit,
            offset=offset,
            sort=["rank_score:desc", "updated_at:desc"] if not query else None,
            show_ranking_score=True,
        )
        elapsed_ms = (time.perf_counter() - start) * 1000
        SEARCH_OPERATIONS_TOTAL.labels(operation="search").inc()
        SEARCH_OPERATION_DURATION.labels(operation="search").observe(elapsed_ms / 1000)
        logger.info(
            f"Meilisearch: search hits={len(results.hits)}",
            ms=f"{elapsed_ms:.1f}",
            query=query[:50] if query else "",
        )

        return results

    def _build_permission_filter(
        self,
        organization_id: UUID,
        user_id: UUID,
        user_group_ids: list[UUID] | None = None,
        my_content_only: bool = False,
        owner_filter: UUID | None = None,
    ) -> str:
        """Build a filter that mirrors ``effective_role``: org match, not
        blocked, and an allow condition.
        """
        org_filter = f'organization_id = "{organization_id}"'

        if my_content_only:
            return f'{org_filter} AND owner_id = "{user_id}"'

        if owner_filter:
            return f'{org_filter} AND owner_id = "{owner_filter}"'

        permission_conditions = [
            f'owner_id = "{user_id}"',
            f'shared_user_ids = "{user_id}"',
            '(access_mode = "OPEN_TO_ORG" AND baseline_role EXISTS)',
        ]
        if user_group_ids:
            group_allow = " OR ".join(f'shared_group_ids = "{gid}"' for gid in user_group_ids)
            permission_conditions.append(f"({group_allow})")
        permission_filter = " OR ".join(permission_conditions)

        block_conditions = [f'NOT blocked_user_ids = "{user_id}"']
        if user_group_ids:
            block_conditions.extend(f'NOT blocked_group_ids = "{gid}"' for gid in user_group_ids)
        block_filter = " AND ".join(block_conditions)

        return f"{org_filter} AND ({block_filter}) AND ({permission_filter})"

    async def update_document_sharing(
        self,
        urn: str,
        organization_id: UUID,
        shared_user_ids: list[UUID],
        shared_group_ids: list[UUID],
        blocked_user_ids: list[UUID] | None = None,
        blocked_group_ids: list[UUID] | None = None,
    ) -> None:
        """Merge new membership lists into the document via ``update_documents``."""
        doc_id = build_document_id(urn, organization_id)
        partial = {
            "id": doc_id,
            "shared_user_ids": [str(uid) for uid in shared_user_ids],
            "shared_group_ids": [str(gid) for gid in shared_group_ids],
            "blocked_user_ids": [str(uid) for uid in (blocked_user_ids or [])],
            "blocked_group_ids": [str(gid) for gid in (blocked_group_ids or [])],
        }

        start = time.perf_counter()
        index = self.client.index(self.config.index_name)
        await index.update_documents([partial])
        elapsed_ms = (time.perf_counter() - start) * 1000
        SEARCH_OPERATIONS_TOTAL.labels(operation="update_sharing").inc()
        SEARCH_OPERATION_DURATION.labels(operation="update_sharing").observe(elapsed_ms / 1000)
        logger.info(
            "Meilisearch: update_sharing "
            f"users={len(shared_user_ids)} groups={len(shared_group_ids)} "
            f"blocked_users={len(blocked_user_ids or [])} "
            f"blocked_groups={len(blocked_group_ids or [])}",
            ms=f"{elapsed_ms:.1f}",
            urn=urn,
        )

    async def update_document_access_policy(
        self,
        urn: str,
        organization_id: UUID,
        access_mode: str,
        baseline_role: str | None,
        owner_id: UUID,
    ) -> None:
        """Merge access-policy fields into the document."""
        doc_id = build_document_id(urn, organization_id)
        partial = {
            "id": doc_id,
            "access_mode": access_mode,
            "baseline_role": baseline_role,
            "owner_id": str(owner_id),
        }

        start = time.perf_counter()
        index = self.client.index(self.config.index_name)
        await index.update_documents([partial])
        elapsed_ms = (time.perf_counter() - start) * 1000
        SEARCH_OPERATIONS_TOTAL.labels(operation="update_access_policy").inc()
        SEARCH_OPERATION_DURATION.labels(operation="update_access_policy").observe(elapsed_ms / 1000)
        logger.info(
            f"Meilisearch: update_access_policy mode={access_mode} baseline={baseline_role}",
            ms=f"{elapsed_ms:.1f}",
            urn=urn,
        )

    async def update_document_tags(
        self,
        urn: str,
        organization_id: UUID,
        tags: list[str],
    ) -> None:
        """Merge the ``tags`` array into the document."""
        doc_id = build_document_id(urn, organization_id)
        partial = {"id": doc_id, "tags": tags}

        start = time.perf_counter()
        index = self.client.index(self.config.index_name)
        await index.update_documents([partial])
        elapsed_ms = (time.perf_counter() - start) * 1000
        SEARCH_OPERATIONS_TOTAL.labels(operation="update_tags").inc()
        SEARCH_OPERATION_DURATION.labels(operation="update_tags").observe(elapsed_ms / 1000)
        logger.info(
            f"Meilisearch: update_tags count={len(tags)}",
            ms=f"{elapsed_ms:.1f}",
            urn=urn,
        )

    async def update_document_tags_bulk(
        self,
        organization_id: UUID,
        items: list[tuple[str, list[str]]],
    ) -> None:
        """Bulk ``tags`` update in one HTTP call. Empty input is a no-op."""
        if not items:
            return
        partials = [
            {"id": build_document_id(urn, organization_id), "tags": tags}
            for urn, tags in items
        ]

        start = time.perf_counter()
        index = self.client.index(self.config.index_name)
        await index.update_documents(partials)
        elapsed_ms = (time.perf_counter() - start) * 1000
        SEARCH_OPERATIONS_TOTAL.labels(operation="update_tags_bulk").inc()
        SEARCH_OPERATION_DURATION.labels(operation="update_tags_bulk").observe(
            elapsed_ms / 1000
        )
        logger.info(
            f"Meilisearch: update_tags_bulk batch={len(partials)}",
            ms=f"{elapsed_ms:.1f}",
        )

    async def get_document(self, urn: str, organization_id: UUID) -> dict[str, Any] | None:
        """One document by ``(urn, organization_id)`` or ``None``."""
        start = time.perf_counter()
        index = self.client.index(self.config.index_name)
        doc_id = build_document_id(urn, organization_id)

        try:
            result = await index.get_document(doc_id)
            elapsed_ms = (time.perf_counter() - start) * 1000
            SEARCH_OPERATIONS_TOTAL.labels(operation="get").inc()
            SEARCH_OPERATION_DURATION.labels(operation="get").observe(elapsed_ms / 1000)
            logger.info(
                f"Meilisearch: get_document found={result is not None}",
                ms=f"{elapsed_ms:.1f}",
                urn=urn,
            )
            return result
        except Exception:
            elapsed_ms = (time.perf_counter() - start) * 1000
            SEARCH_OPERATIONS_TOTAL.labels(operation="get").inc()
            SEARCH_OPERATION_DURATION.labels(operation="get").observe(elapsed_ms / 1000)
            SEARCH_OPERATION_ERRORS_TOTAL.labels(operation="get").inc()
            logger.info(
                "Meilisearch: get_document found=False",
                ms=f"{elapsed_ms:.1f}",
                urn=urn,
            )
            return None

    async def get_documents_by_urns(
        self,
        urns: list[str],
        organization_id: UUID,
    ) -> dict[str, dict[str, Any]]:
        """Map ``urn -> document`` for the requested URNs in one org via chunked filter lookups."""
        if not urns:
            return {}

        start = time.perf_counter()
        index = self.client.index(self.config.index_name)
        org_filter = f'organization_id = "{organization_id}"'

        # Chunk to stay under Meilisearch's filter complexity limits.
        result: dict[str, dict[str, Any]] = {}
        chunk_size = 50

        try:
            for i in range(0, len(urns), chunk_size):
                chunk = urns[i : i + chunk_size]
                urn_filters = " OR ".join(f'urn = "{urn}"' for urn in chunk)
                combined_filter = f"({urn_filters}) AND {org_filter}"

                docs = await index.get_documents(
                    filter=combined_filter,
                    limit=len(chunk),
                )
                for doc in docs.results:
                    if "urn" in doc:
                        result[doc["urn"]] = doc

            elapsed_ms = (time.perf_counter() - start) * 1000
            SEARCH_OPERATIONS_TOTAL.labels(operation="get_batch").inc()
            SEARCH_OPERATION_DURATION.labels(operation="get_batch").observe(elapsed_ms / 1000)
            logger.info(
                f"Meilisearch: get_documents_by_urns found={len(result)}/{len(urns)}",
                ms=f"{elapsed_ms:.1f}",
            )
            return result
        except Exception as e:
            elapsed_ms = (time.perf_counter() - start) * 1000
            SEARCH_OPERATIONS_TOTAL.labels(operation="get_batch").inc()
            SEARCH_OPERATION_DURATION.labels(operation="get_batch").observe(elapsed_ms / 1000)
            SEARCH_OPERATION_ERRORS_TOTAL.labels(operation="get_batch").inc()
            logger.warning(
                f"Meilisearch: get_documents_by_urns failed: {e}",
                ms=f"{elapsed_ms:.1f}",
            )
            return {}

    async def health_check(self) -> bool:
        start = time.perf_counter()
        try:
            health = await self.client.health()
            is_healthy = health.status == "available"
            elapsed_ms = (time.perf_counter() - start) * 1000
            logger.info(
                f"Meilisearch: health_check status={health.status}",
                ms=f"{elapsed_ms:.1f}",
            )
            return is_healthy
        except Exception as e:
            elapsed_ms = (time.perf_counter() - start) * 1000
            SEARCH_OPERATION_ERRORS_TOTAL.labels(operation="health_check").inc()
            logger.warning(
                f"Meilisearch: health_check failed: {e}",
                ms=f"{elapsed_ms:.1f}",
            )
            return False


_meilisearch_client: MeilisearchClient | None = None


async def init_meilisearch() -> MeilisearchClient:
    """Initialize the process-singleton Meilisearch client. Called during app startup."""
    global _meilisearch_client

    config = MeilisearchConfig.from_env()
    _meilisearch_client = MeilisearchClient(config)
    _meilisearch_client._client = AsyncClient(
        config.url,
        config.master_key,
        timeout=config.timeout,
    )

    await _meilisearch_client.ensure_index()

    logger.info(f"Meilisearch client initialized: {config.url}")
    return _meilisearch_client


async def close_meilisearch() -> None:
    """Close the process-singleton client. Called during app shutdown."""
    global _meilisearch_client

    if _meilisearch_client and _meilisearch_client._client:
        await _meilisearch_client._client.aclose()
        _meilisearch_client = None
        logger.info("Meilisearch client closed")


def get_meilisearch_client() -> MeilisearchClient:
    if _meilisearch_client is None:
        raise RuntimeError("Meilisearch client not initialized. Call init_meilisearch() first.")
    return _meilisearch_client
