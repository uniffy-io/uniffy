"""An in-memory search engine standing in for Meilisearch behind the real indexer."""

from typing import Any

from uniffy.core.search.engine import (
    SearchAll,
    SearchAny,
    SearchDocument,
    SearchDocumentsPage,
    SearchEngineError,
    SearchExists,
    SearchFilter,
    SearchNot,
    SearchPage,
    SearchQuery,
    SearchSchema,
    SearchTerm,
)
from uniffy.core.search.indexer import SearchIndexer, build_content_urn
from uniffy.core.search.workspace import WorkspaceSearch
from uniffy.core.types import ContentType

_MISSING = object()


def _lookup(document: SearchDocument, field: str) -> Any:
    """The value at a dotted path, as Meilisearch filters address nested fields."""
    found: Any = document
    for part in field.split("."):
        if not isinstance(found, dict) or part not in found:
            return _MISSING
        found = found[part]
    return found


def _matches(document: SearchDocument, expression: SearchFilter) -> bool:
    match expression:
        case SearchTerm(field, value):
            found = _lookup(document, field)
            return value in found if isinstance(found, list) else found == value
        case SearchExists(field):
            return _lookup(document, field) is not _MISSING
        case SearchNot(inner):
            return not _matches(document, inner)
        case SearchAll(expressions):
            return all(_matches(document, inner) for inner in expressions)
        case SearchAny(expressions):
            return any(_matches(document, inner) for inner in expressions)


class RecordingSearchEngine:
    """Keeps indexed documents by id; while ``available`` is false every call fails."""

    def __init__(self) -> None:
        self.documents: dict[str, SearchDocument] = {}
        self.available = True

    def _reachable(self) -> None:
        if not self.available:
            raise SearchEngineError("search unavailable")

    def indexed(self, content_type: ContentType, content_id: Any) -> SearchDocument | None:
        """The document indexed for one content item, or ``None`` when it is not indexed."""
        urn = build_content_urn(content_type, content_id)
        return next((doc for doc in self.documents.values() if doc["urn"] == urn), None)

    def indexed_text(self, content_type: ContentType, content_id: Any) -> str | None:
        """Searchable text indexed for one content item, or ``None`` when it is not indexed."""
        found = self.indexed(content_type, content_id)
        return found["content"] if found else None

    async def startup(self, schema: SearchSchema) -> None:
        self._reachable()

    async def shutdown(self) -> None:
        return None

    async def put_documents(self, documents: list[SearchDocument]) -> None:
        self._reachable()
        for document in documents:
            self.documents[document["id"]] = dict(document)

    async def patch_documents(
        self,
        documents: list[SearchDocument],
        *,
        create_missing: bool = True,
        wait: bool = False,
    ) -> None:
        self._reachable()
        for patch in documents:
            existing = self.documents.get(patch["id"])
            if existing is not None:
                existing.update(patch)
            elif create_missing:
                self.documents[patch["id"]] = dict(patch)

    async def delete_document(self, document_id: str) -> None:
        self._reachable()
        self.documents.pop(document_id, None)

    async def delete_by_filter(self, expression: SearchFilter) -> None:
        self._reachable()
        for document_id, document in list(self.documents.items()):
            if _matches(document, expression):
                del self.documents[document_id]

    async def search(self, query: SearchQuery) -> SearchPage:
        self._reachable()
        return SearchPage(hits=(), estimated_total_hits=0)

    async def fetch_documents(
        self,
        expression: SearchFilter,
        *,
        fields: tuple[str, ...] = (),
        limit: int = 20,
        offset: int = 0,
    ) -> SearchDocumentsPage:
        self._reachable()
        found = [doc for doc in self.documents.values() if _matches(doc, expression)]
        return SearchDocumentsPage(documents=tuple(found[offset : offset + limit]))

    async def health(self) -> bool:
        return self.available


def recording_indexer(engine: RecordingSearchEngine | None = None) -> SearchIndexer:
    """The production indexer writing into ``engine``, or into a fresh one nobody reads."""
    return SearchIndexer(WorkspaceSearch(engine or RecordingSearchEngine()))
