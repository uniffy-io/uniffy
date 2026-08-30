"""Meilisearch implementation of the core search-engine contract."""

from __future__ import annotations

import os
import re
import time
from collections.abc import Awaitable
from dataclasses import dataclass
from typing import TypeVar

from loguru import logger
from meilisearch_python_sdk import AsyncClient
from meilisearch_python_sdk.errors import MeilisearchApiError
from meilisearch_python_sdk.models.settings import (
    Faceting,
    MeilisearchSettings,
    MinWordSizeForTypos,
    Pagination,
    TypoTolerance,
)

from uniffy.core.search.engine import (
    SearchAll,
    SearchAny,
    SearchDocument,
    SearchDocumentsPage,
    SearchEngineError,
    SearchExists,
    SearchFilter,
    SearchHit,
    SearchNot,
    SearchPage,
    SearchQuery,
    SearchScalar,
    SearchSchema,
    SearchTerm,
)
from uniffy.infrastructure.search.metrics import (
    SEARCH_OPERATION_DURATION,
    SEARCH_OPERATION_ERRORS_TOTAL,
    SEARCH_OPERATIONS_TOTAL,
)

logger = logger.bind(component="infrastructure.search.meili")

_FIELD_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_.]*$")
_PERMANENT_ERROR_CODES = {
    "invalid_document_filter",
    "missing_document_filter",
    "invalid_document_id",
}
_INDEX_NOT_FOUND = "index_not_found"
_SUCCEEDED = "succeeded"
_DEFAULT_INDEX_NAME = "uniffy"

T = TypeVar("T")


@dataclass(frozen=True, slots=True)
class MeiliConfig:
    url: str
    master_key: str
    index_name: str = _DEFAULT_INDEX_NAME
    timeout_seconds: int = 30

    @classmethod
    def from_env(cls) -> MeiliConfig:
        return cls(
            url=os.getenv("MEILISEARCH_URL", "http://localhost:7700"),
            master_key=os.getenv("MEILISEARCH_MASTER_KEY", "uniffy-dev-master-key"),
            index_name=os.getenv("MEILISEARCH_INDEX_NAME", _DEFAULT_INDEX_NAME),
            timeout_seconds=int(os.getenv("MEILISEARCH_TIMEOUT", "30")),
        )


def escape_filter_value(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _render_scalar(value: SearchScalar) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return f'"{escape_filter_value(value)}"'
    return str(value)


def _validate_field(field: str) -> str:
    if not _FIELD_PATTERN.fullmatch(field):
        raise SearchEngineError(
            "Invalid search filter field",
            code="invalid_filter_field",
            retryable=False,
        )
    return field


def render_filter(expression: SearchFilter) -> str:
    if isinstance(expression, SearchTerm):
        return f"{_validate_field(expression.field)} = {_render_scalar(expression.value)}"
    if isinstance(expression, SearchExists):
        return f"{_validate_field(expression.field)} EXISTS"
    if isinstance(expression, SearchNot):
        return f"NOT ({render_filter(expression.expression)})"
    if isinstance(expression, SearchAll):
        return " AND ".join(f"({render_filter(item)})" for item in expression.expressions)
    if isinstance(expression, SearchAny):
        return " OR ".join(f"({render_filter(item)})" for item in expression.expressions)
    raise SearchEngineError(
        "Unsupported search filter expression",
        code="invalid_filter_expression",
        retryable=False,
    )


def _settings(schema: SearchSchema) -> MeilisearchSettings:
    typo = schema.typo_tolerance
    return MeilisearchSettings(
        searchable_attributes=list(schema.searchable_fields),
        filterable_attributes=list(schema.filterable_fields),
        sortable_attributes=list(schema.sortable_fields),
        ranking_rules=[rule.value for rule in schema.ranking_rules],
        stop_words=list(schema.stop_words),
        synonyms={key: list(values) for key, values in schema.synonyms.items()},
        typo_tolerance=TypoTolerance(
            enabled=typo.enabled,
            min_word_size_for_typos=MinWordSizeForTypos(
                one_typo=typo.one_typo_min_word_size,
                two_typos=typo.two_typo_min_word_size,
            ),
        ),
        faceting=Faceting(max_values_per_facet=schema.max_values_per_facet),
        pagination=Pagination(max_total_hits=schema.max_total_hits),
    )


def _translate_error(exc: Exception) -> SearchEngineError:
    if isinstance(exc, SearchEngineError):
        return exc
    code = getattr(exc, "code", None) or None
    return SearchEngineError(
        "Search engine request failed",
        code=code,
        retryable=code not in _PERMANENT_ERROR_CODES,
    )


class MeiliSearchEngine:
    def __init__(self, config: MeiliConfig | None = None) -> None:
        self.config = config or MeiliConfig.from_env()
        self._client: AsyncClient | None = None

    @property
    def client(self) -> AsyncClient:
        if self._client is None:
            raise RuntimeError("Search engine is not initialized")
        return self._client

    async def startup(self, schema: SearchSchema) -> None:
        self._client = AsyncClient(
            self.config.url,
            self.config.master_key,
            timeout=self.config.timeout_seconds,
        )
        try:
            index = await self.client.get_index(self.config.index_name)
        except MeilisearchApiError as exc:
            if exc.code != _INDEX_NOT_FOUND:
                raise _translate_error(exc) from exc
            await self.client.create_index(
                self.config.index_name,
                primary_key=schema.primary_key,
                settings=_settings(schema),
            )
        except Exception as exc:
            raise _translate_error(exc) from exc
        else:
            try:
                await index.update_settings(_settings(schema))
            except Exception as exc:
                raise _translate_error(exc) from exc
        logger.info("Meilisearch engine initialized", url=self.config.url)

    async def shutdown(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
            logger.info("Meilisearch engine closed")

    async def _observe(
        self,
        operation: str,
        request: Awaitable[T],
        *,
        count: int = 1,
    ) -> T:
        started = time.perf_counter()
        try:
            result = await request
        except Exception as exc:
            SEARCH_OPERATION_ERRORS_TOTAL.labels(operation=operation).inc()
            raise _translate_error(exc) from exc
        elapsed = time.perf_counter() - started
        SEARCH_OPERATIONS_TOTAL.labels(operation=operation).inc(count)
        SEARCH_OPERATION_DURATION.labels(operation=operation).observe(elapsed)
        return result

    async def _await_task(self, task: object | None) -> None:
        if task is None:
            raise SearchEngineError("Search engine did not return a task")
        task_uid = getattr(task, "task_uid", None) or getattr(task, "taskUid", None)
        if task_uid is None:
            raise SearchEngineError("Search engine task has no identity")
        result = await self._observe(
            "wait_task",
            self.client.wait_for_task(task_uid, timeout_in_ms=5000),
        )
        if str(getattr(result, "status", "")).lower() != _SUCCEEDED:
            raise SearchEngineError("Search engine task did not succeed")

    def _index(self):
        return self.client.index(self.config.index_name)

    async def put_documents(self, documents: list[SearchDocument]) -> None:
        if documents:
            await self._observe(
                "index",
                self._index().add_documents(documents),
                count=len(documents),
            )

    async def patch_documents(
        self,
        documents: list[SearchDocument],
        *,
        create_missing: bool = True,
        wait: bool = False,
    ) -> None:
        if not documents:
            return
        task = await self._observe(
            "update",
            self._index().update_documents(
                documents,
                skip_creation=not create_missing,
            ),
            count=len(documents),
        )
        if wait:
            await self._await_task(task)

    async def delete_document(self, document_id: str) -> None:
        task = await self._observe("delete", self._index().delete_document(document_id))
        await self._await_task(task)

    async def delete_by_filter(self, expression: SearchFilter) -> None:
        task = await self._observe(
            "delete",
            self._index().delete_documents_by_filter(render_filter(expression)),
        )
        await self._await_task(task)

    async def search(self, query: SearchQuery) -> SearchPage:
        result = await self._observe(
            "search",
            self._index().search(
                query=query.text,
                filter=render_filter(query.filter),
                limit=query.limit,
                offset=query.offset,
                sort=[f"{item.field}:{'desc' if item.descending else 'asc'}" for item in query.sort]
                or None,
                show_ranking_score=query.include_score,
                attributes_to_retrieve=list(query.retrieve_fields) or None,
                attributes_to_search_on=(
                    list(query.search_fields) if query.search_fields is not None else None
                ),
                attributes_to_highlight=list(query.highlight_fields) or None,
                highlight_pre_tag=query.highlight_pre_tag or None,
                highlight_post_tag=query.highlight_post_tag or None,
                attributes_to_crop=list(query.crop_fields) or None,
                crop_length=query.crop_length,
                crop_marker=query.crop_marker,
            ),
        )
        hits = []
        for raw_hit in result.hits:
            document = dict(raw_hit)
            formatted = document.pop("_formatted", {}) or {}
            score = document.pop("_rankingScore", None)
            hits.append(SearchHit(document=document, formatted=formatted, score=score))
        return SearchPage(
            hits=tuple(hits),
            estimated_total_hits=result.estimated_total_hits or len(hits),
        )

    async def fetch_documents(
        self,
        expression: SearchFilter,
        *,
        fields: tuple[str, ...] = (),
        limit: int = 20,
        offset: int = 0,
    ) -> SearchDocumentsPage:
        result = await self._observe(
            "get_batch",
            self._index().get_documents(
                filter=render_filter(expression),
                fields=list(fields) or None,
                limit=limit,
                offset=offset,
            ),
        )
        return SearchDocumentsPage(tuple(dict(document) for document in result.results))

    async def health(self) -> bool:
        try:
            result = await self._observe("health_check", self.client.health())
        except SearchEngineError:
            return False
        return result.status == "available"  # noqa: PLR2004 - Meilisearch wire value
