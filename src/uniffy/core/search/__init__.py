"""Unified content search backed by Meilisearch."""

from uniffy.core.search.indexer import SearchIndexer, build_content_urn
from uniffy.core.search.meilisearch import (
    INDEX_SETTINGS,
    UNIFFY_INDEX_NAME,
    MeilisearchClient,
    MeilisearchConfig,
    close_meilisearch,
    get_meilisearch_client,
    init_meilisearch,
)

__all__ = [
    "SearchIndexer",
    "build_content_urn",
    "MeilisearchClient",
    "MeilisearchConfig",
    "init_meilisearch",
    "close_meilisearch",
    "get_meilisearch_client",
    "UNIFFY_INDEX_NAME",
    "INDEX_SETTINGS",
]
