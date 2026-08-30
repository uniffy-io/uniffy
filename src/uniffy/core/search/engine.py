"""Vendor-neutral full-text search engine contract."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Protocol

type SearchScalar = str | int | float | bool | None
type SearchDocument = dict[str, Any]


class SearchFilterKind(StrEnum):
    TERM = "term"
    EXISTS = "exists"
    NOT = "not"
    ALL = "all"
    ANY = "any"


class SearchRankingRule(StrEnum):
    WORDS = "words"
    TYPO = "typo"
    PROXIMITY = "proximity"
    ATTRIBUTE = "attribute"
    SORT = "sort"
    EXACTNESS = "exactness"


@dataclass(frozen=True, slots=True)
class SearchTerm:
    field: str
    value: SearchScalar


@dataclass(frozen=True, slots=True)
class SearchExists:
    field: str


@dataclass(frozen=True, slots=True)
class SearchNot:
    expression: SearchFilter


@dataclass(frozen=True, slots=True)
class SearchAll:
    expressions: tuple[SearchFilter, ...]

    def __post_init__(self) -> None:
        if not self.expressions:
            raise ValueError("SearchAll requires at least one expression")


@dataclass(frozen=True, slots=True)
class SearchAny:
    expressions: tuple[SearchFilter, ...]

    def __post_init__(self) -> None:
        if not self.expressions:
            raise ValueError("SearchAny requires at least one expression")


type SearchFilter = SearchTerm | SearchExists | SearchNot | SearchAll | SearchAny


def all_of(*expressions: SearchFilter) -> SearchFilter:
    if len(expressions) == 1:
        return expressions[0]
    return SearchAll(tuple(expressions))


def any_of(*expressions: SearchFilter) -> SearchFilter:
    if len(expressions) == 1:
        return expressions[0]
    return SearchAny(tuple(expressions))


def search_filter_to_data(expression: SearchFilter) -> dict[str, Any]:
    if isinstance(expression, SearchTerm):
        return {
            "kind": SearchFilterKind.TERM.value,
            "field": expression.field,
            "value": expression.value,
        }
    if isinstance(expression, SearchExists):
        return {"kind": SearchFilterKind.EXISTS.value, "field": expression.field}
    if isinstance(expression, SearchNot):
        return {
            "kind": SearchFilterKind.NOT.value,
            "expression": search_filter_to_data(expression.expression),
        }
    if isinstance(expression, SearchAll):
        return {
            "kind": SearchFilterKind.ALL.value,
            "expressions": [search_filter_to_data(item) for item in expression.expressions],
        }
    return {
        "kind": SearchFilterKind.ANY.value,
        "expressions": [search_filter_to_data(item) for item in expression.expressions],
    }


def search_filter_from_data(data: dict[str, Any]) -> SearchFilter:
    try:
        kind = SearchFilterKind(data.get("kind"))
    except (TypeError, ValueError) as exc:
        raise ValueError("Unknown search filter kind") from exc
    if kind is SearchFilterKind.TERM:
        field = data.get("field")
        if not isinstance(field, str) or not field:
            raise ValueError("Search term field must be a non-empty string")
        value = data.get("value")
        if value is not None and not isinstance(value, str | int | float | bool):
            raise ValueError("Search term value must be scalar")
        return SearchTerm(field=field, value=value)
    if kind is SearchFilterKind.EXISTS:
        field = data.get("field")
        if not isinstance(field, str) or not field:
            raise ValueError("Search exists field must be a non-empty string")
        return SearchExists(field=field)
    if kind is SearchFilterKind.NOT:
        nested = data.get("expression")
        if not isinstance(nested, dict):
            raise ValueError("Search not expression must be an object")
        return SearchNot(search_filter_from_data(nested))
    if kind in {SearchFilterKind.ALL, SearchFilterKind.ANY}:
        nested = data.get("expressions")
        if not isinstance(nested, list) or not all(isinstance(item, dict) for item in nested):
            raise ValueError("Search compound expressions must be an object list")
        expressions = tuple(search_filter_from_data(item) for item in nested)
        return SearchAll(expressions) if kind is SearchFilterKind.ALL else SearchAny(expressions)
    raise ValueError("Unknown search filter kind")


@dataclass(frozen=True, slots=True)
class SearchTypoTolerance:
    enabled: bool = True
    one_typo_min_word_size: int = 4
    two_typo_min_word_size: int = 8


@dataclass(frozen=True, slots=True)
class SearchSchema:
    primary_key: str
    searchable_fields: tuple[str, ...]
    filterable_fields: tuple[str, ...]
    sortable_fields: tuple[str, ...]
    ranking_rules: tuple[SearchRankingRule, ...]
    stop_words: tuple[str, ...]
    synonyms: dict[str, tuple[str, ...]]
    typo_tolerance: SearchTypoTolerance = SearchTypoTolerance()
    max_values_per_facet: int = 100
    max_total_hits: int = 1000


@dataclass(frozen=True, slots=True)
class SearchSort:
    field: str
    descending: bool = False


@dataclass(frozen=True, slots=True)
class SearchQuery:
    text: str | None
    filter: SearchFilter
    limit: int
    offset: int
    sort: tuple[SearchSort, ...] = ()
    retrieve_fields: tuple[str, ...] = ()
    search_fields: tuple[str, ...] | None = None
    highlight_fields: tuple[str, ...] = ()
    highlight_pre_tag: str = ""
    highlight_post_tag: str = ""
    crop_fields: tuple[str, ...] = ()
    crop_length: int = 20
    crop_marker: str = "…"
    include_score: bool = False


@dataclass(frozen=True, slots=True)
class SearchHit:
    document: SearchDocument
    formatted: dict[str, Any]
    score: float | None


@dataclass(frozen=True, slots=True)
class SearchPage:
    hits: tuple[SearchHit, ...]
    estimated_total_hits: int


@dataclass(frozen=True, slots=True)
class SearchDocumentsPage:
    documents: tuple[SearchDocument, ...]


class SearchEngineError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        retryable: bool = True,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


class SearchEngine(Protocol):
    async def startup(self, schema: SearchSchema) -> None: ...

    async def shutdown(self) -> None: ...

    async def put_documents(self, documents: list[SearchDocument]) -> None: ...

    async def patch_documents(
        self,
        documents: list[SearchDocument],
        *,
        create_missing: bool = True,
        wait: bool = False,
    ) -> None: ...

    async def delete_document(self, document_id: str) -> None: ...

    async def delete_by_filter(self, expression: SearchFilter) -> None: ...

    async def search(self, query: SearchQuery) -> SearchPage: ...

    async def fetch_documents(
        self,
        expression: SearchFilter,
        *,
        fields: tuple[str, ...] = (),
        limit: int = 20,
        offset: int = 0,
    ) -> SearchDocumentsPage: ...

    async def health(self) -> bool: ...
