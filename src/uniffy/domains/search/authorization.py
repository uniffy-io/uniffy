import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from uuid import UUID

from uniffy.core.content.references import parse_urn
from uniffy.core.search.meilisearch import SearchCandidateScope
from uniffy.domains.permissions.access import (
    ResourceAccessPurpose,
    ResourceAccessResolver,
    ResourceKey,
    ResourceRowState,
)
from uniffy.domains.search.queries import SearchResult, apply_type_priority
from uniffy.observability.metrics import (
    SEARCH_AUTHORIZATION_TOTAL,
    SearchAuthorizationOutcome,
)

SearchExecutor = Callable[..., Awaitable[tuple[list[SearchResult], int]]]

_MAX_CANDIDATES = 300
_INITIAL_CANDIDATES = 60


@dataclass(frozen=True, slots=True)
class AuthorizedSearchQuery:
    user_id: UUID
    organization_id: UUID
    query_text: str
    user_group_ids: tuple[UUID, ...]
    candidate_scope: SearchCandidateScope
    type_filters: tuple[str, ...] | None
    tag_filters: tuple[str, ...] | None
    my_content_only: bool
    owner_filter: UUID | None
    metadata_filters: dict[str, str] | None
    limit: int
    offset: int
    type_priority: tuple[str, ...] | None
    name_matches_only: bool


class AuthorizedSearch:
    def __init__(
        self,
        resolver: ResourceAccessResolver,
        executor: SearchExecutor,
    ) -> None:
        self.resolver = resolver
        self.executor = executor

    async def run(
        self,
        query: AuthorizedSearchQuery,
    ) -> tuple[list[SearchResult], bool, int]:
        if query.type_priority:
            authorized = await self._prioritized(query)
            authorized = apply_type_priority(authorized, list(query.type_priority))
        else:
            authorized = await self._progressive(query)

        has_more = len(authorized) > query.offset + query.limit
        page = authorized[query.offset : query.offset + query.limit]
        return page, has_more, query.offset + len(page)

    async def _progressive(self, query: AuthorizedSearchQuery) -> list[SearchResult]:
        candidate_limit = min(
            max((query.offset + query.limit + 1) * 3, _INITIAL_CANDIDATES),
            _MAX_CANDIDATES,
        )
        candidate_offset = 0
        authorized: list[SearchResult] = []
        seen_urns: set[str] = set()

        while candidate_offset < _MAX_CANDIDATES:
            chunk_limit = min(candidate_limit, _MAX_CANDIDATES - candidate_offset)
            candidates, estimated_total = await self._execute(
                query,
                limit=chunk_limit,
                offset=candidate_offset,
                type_filters=query.type_filters,
            )
            candidate_offset += len(candidates)
            authorized.extend(await self._authorize(query, candidates, seen_urns))

            exhausted = len(candidates) < chunk_limit or candidate_offset >= estimated_total
            if exhausted or candidate_offset >= _MAX_CANDIDATES:
                break
            if len(authorized) >= query.offset + query.limit + 1:
                break
            candidate_limit = min(_INITIAL_CANDIDATES, _MAX_CANDIDATES - candidate_offset)

        return authorized

    async def _prioritized(self, query: AuthorizedSearchQuery) -> list[SearchResult]:
        target_count = query.offset + query.limit + 1
        allowed_types = set(query.type_filters or ())
        priority_types = tuple(
            content_type
            for content_type in dict.fromkeys(query.type_priority or ())
            if not allowed_types or content_type in allowed_types
        )
        priority_set = set(priority_types)
        has_fallback = not allowed_types or bool(allowed_types - priority_set)
        buckets: dict[str | None, list[SearchResult]] = {
            content_type: [] for content_type in priority_types
        }
        if has_fallback:
            buckets[None] = []

        seen_urns: set[str] = set()
        initial_limit = min(_INITIAL_CANDIDATES, _MAX_CANDIDATES)
        initial, general_total = await self._execute(
            query,
            limit=initial_limit,
            offset=0,
            type_filters=query.type_filters,
        )
        queried = len(initial)
        general_offset = len(initial)
        general_exhausted = len(initial) < initial_limit or general_offset >= general_total
        await self._authorize_into_buckets(
            query,
            initial,
            priority_set,
            buckets,
            seen_urns,
            mixed=True,
        )

        tier_offsets = {content_type: 0 for content_type in priority_types}
        tier_exhausted = {content_type: False for content_type in priority_types}

        while queried < _MAX_CANDIDATES:
            pending: list[str | None] = [
                content_type
                for content_type in priority_types
                if len(buckets[content_type]) < target_count and not tier_exhausted[content_type]
            ]
            if has_fallback and len(buckets[None]) < target_count and not general_exhausted:
                pending.append(None)
            if not pending:
                break

            remaining = _MAX_CANDIDATES - queried
            requests: list[tuple[str | None, int, int]] = []
            for index, bucket in enumerate(pending):
                slots = len(pending) - index
                allocation = max(1, remaining // slots)
                if bucket is None:
                    desired = _INITIAL_CANDIDATES
                    bucket_offset = general_offset
                else:
                    desired = max(
                        20,
                        target_count - len(buckets[bucket]) + tier_offsets[bucket],
                    )
                    bucket_offset = tier_offsets[bucket]
                request_limit = min(_INITIAL_CANDIDATES, desired, allocation)
                requests.append((bucket, request_limit, bucket_offset))
                remaining -= request_limit

            responses = await asyncio.gather(*[
                self._execute(
                    query,
                    limit=request_limit,
                    offset=bucket_offset,
                    type_filters=(query.type_filters if bucket is None else (bucket,)),
                )
                for bucket, request_limit, bucket_offset in requests
            ])

            for (bucket, request_limit, _), (candidates, estimated_total) in zip(
                requests,
                responses,
                strict=True,
            ):
                queried += len(candidates)
                if bucket is None:
                    general_offset += len(candidates)
                    general_exhausted = (
                        len(candidates) < request_limit or general_offset >= estimated_total
                    )
                else:
                    tier_offsets[bucket] += len(candidates)
                    tier_exhausted[bucket] = (
                        len(candidates) < request_limit or tier_offsets[bucket] >= estimated_total
                    )
                await self._authorize_into_buckets(
                    query,
                    candidates,
                    priority_set,
                    buckets,
                    seen_urns,
                    expected_bucket=bucket,
                )

        return [
            result
            for content_type in (*priority_types, None)
            for result in buckets.get(content_type, ())
        ]

    async def _authorize_into_buckets(
        self,
        query: AuthorizedSearchQuery,
        candidates: list[SearchResult],
        priority_types: set[str],
        buckets: dict[str | None, list[SearchResult]],
        seen_urns: set[str],
        *,
        expected_bucket: str | None = None,
        mixed: bool = False,
    ) -> None:
        filtered = [
            candidate
            for candidate in candidates
            if (
                True
                if mixed
                else (
                    candidate.entity_type not in priority_types
                    if expected_bucket is None
                    else candidate.entity_type == expected_bucket
                )
            )
        ]
        authorized = await self._authorize(query, filtered, seen_urns)
        for candidate in authorized:
            bucket = candidate.entity_type if candidate.entity_type in priority_types else None
            if bucket in buckets:
                buckets[bucket].append(candidate)

    async def _authorize(
        self,
        query: AuthorizedSearchQuery,
        candidates: list[SearchResult],
        seen_urns: set[str],
    ) -> list[SearchResult]:
        candidates_by_key: dict[ResourceKey, SearchResult] = {}
        for candidate in candidates:
            parsed = parse_urn(candidate.urn)
            if (
                parsed is None
                or candidate.urn in seen_urns
                or candidate.organization_id != query.organization_id
            ):
                continue
            seen_urns.add(candidate.urn)
            candidates_by_key[ResourceKey(*parsed)] = candidate

        decisions = await self.resolver.resolve(
            actor_id=query.user_id,
            organization_id=query.organization_id,
            keys=candidates_by_key,
            purpose=ResourceAccessPurpose.SEARCH,
        )
        outcomes = {
            SearchAuthorizationOutcome.ALLOWED: 0,
            SearchAuthorizationOutcome.DENIED: 0,
            SearchAuthorizationOutcome.UNRESOLVED: 0,
        }
        for key in candidates_by_key:
            decision = decisions.get(key)
            if decision is None or decision.row_state != ResourceRowState.LIVE:
                outcomes[SearchAuthorizationOutcome.UNRESOLVED] += 1
            elif decision.can_view:
                outcomes[SearchAuthorizationOutcome.ALLOWED] += 1
            else:
                outcomes[SearchAuthorizationOutcome.DENIED] += 1
        for outcome, count in outcomes.items():
            SEARCH_AUTHORIZATION_TOTAL.labels(outcome=outcome.value).inc(count)

        return [
            candidate
            for key, candidate in candidates_by_key.items()
            if (decision := decisions.get(key)) is not None
            and decision.row_state == ResourceRowState.LIVE
            and decision.can_view
        ]

    async def _execute(
        self,
        query: AuthorizedSearchQuery,
        *,
        limit: int,
        offset: int,
        type_filters: tuple[str, ...] | None,
    ) -> tuple[list[SearchResult], int]:
        return await self.executor(
            query_text=query.query_text,
            organization_id=query.organization_id,
            user_id=query.user_id,
            user_group_ids=list(query.user_group_ids),
            type_filters=list(type_filters) if type_filters else None,
            tag_filters=list(query.tag_filters) if query.tag_filters else None,
            my_content_only=query.my_content_only,
            owner_filter=query.owner_filter,
            metadata_filters=query.metadata_filters,
            limit=limit,
            offset=offset,
            name_matches_only=query.name_matches_only,
            candidate_scope=query.candidate_scope,
        )
