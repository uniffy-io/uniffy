"""
Search domain - Unified fuzzy search across all content.

Provides global search functionality with permission filtering
using PostgreSQL pg_trgm for typo-tolerant matching.
"""

from uniffy.domains.search.operations import SearchOperations
from uniffy.domains.search.service import SearchServiceImpl

__all__ = [
    "SearchOperations",
    "SearchServiceImpl",
]
