"""
Core infrastructure module for UWOS.

This module contains shared utilities, base classes, and infrastructure
that is used across all domain modules.

Submodules
----------
types : Shared enums (VisibilityScope, ContentType, etc.)
errors : Custom exception classes
auth : Authentication, authorization, and permissions
search : Unified search indexing
content : Base classes for content operations
converters : Proto/model conversion utilities
"""

from uwos.core.errors import (
    AuthenticationError,
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
    UWOSError,
    ValidationError,
)
from uwos.core.types import (
    ContentType,
    NodeType,
    PermissionLevel,
    SubjectType,
    VisibilityScope,
)

__all__ = [
    # Enums
    "ContentType",
    "NodeType",
    "PermissionLevel",
    "SubjectType",
    "VisibilityScope",
    # Errors
    "AuthenticationError",
    "ConflictError",
    "NotFoundError",
    "PermissionDeniedError",
    "UWOSError",
    "ValidationError",
]
