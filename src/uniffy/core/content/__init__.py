"""
Content module for base content operations.

Provides base classes and utilities for building content
domain services with built-in permission checking and search indexing.
"""

from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.content.types import ContentModel, TModel

__all__ = [
    "BaseContentOperations",
    "ContentModel",
    "TModel",
]
