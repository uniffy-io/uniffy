"""
Search module for unified content search.

Provides search indexing and querying capabilities across all content types
using Meilisearch for full-text search with typo tolerance.
"""

from uwos.core.search.indexer import SearchIndexer, build_content_urn
from uwos.core.search.meilisearch import (
    INDEX_SETTINGS,
    UWOS_INDEX_NAME,
    MeilisearchClient,
    MeilisearchConfig,
    close_meilisearch,
    get_meilisearch_client,
    init_meilisearch,
)

__all__ = [
    # Indexer (used by BaseContentOperations)
    "SearchIndexer",
    "build_content_urn",
    # Meilisearch client
    "MeilisearchClient",
    "MeilisearchConfig",
    "init_meilisearch",
    "close_meilisearch",
    "get_meilisearch_client",
    # Constants
    "UWOS_INDEX_NAME",
    "INDEX_SETTINGS",
]
