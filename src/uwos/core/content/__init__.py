"""
Content module for base content operations.

Provides base classes and utilities for building content
domain services with built-in permission checking and search indexing.
"""

from uwos.core.content.base_operations import BaseContentOperations
from uwos.core.content.types import ContentModel, TModel

__all__ = [
    "BaseContentOperations",
    "ContentModel",
    "TModel",
]
