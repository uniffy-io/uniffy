"""Vendor-neutral workspace search contracts and policy."""

from uniffy.core.search.indexer import SEARCH_INDEXER_CTX_KEY, SearchIndexer, build_content_urn
from uniffy.core.search.policy import (
    FILTERABLE_METADATA_KEYS,
    WORKSPACE_SEARCH_SCHEMA,
    SearchCandidateScope,
    build_document_id,
)
from uniffy.core.search.workspace import WORKSPACE_SEARCH_CTX_KEY, WorkspaceSearch

__all__ = [
    "SearchIndexer",
    "SEARCH_INDEXER_CTX_KEY",
    "SearchCandidateScope",
    "WorkspaceSearch",
    "WORKSPACE_SEARCH_CTX_KEY",
    "WORKSPACE_SEARCH_SCHEMA",
    "FILTERABLE_METADATA_KEYS",
    "build_document_id",
    "build_content_urn",
]
