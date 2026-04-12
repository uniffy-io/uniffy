"""
Core infrastructure module for UNIFFY.

This module contains shared utilities, base classes, and infrastructure
that is used across all domain modules.

Submodules
----------
types : Shared enums (ContentRole, AccessMode, ContentType, etc.)
errors : Custom exception classes
auth : Authentication, authorization, and permissions
search : Unified search indexing
content : Base classes for content operations
converters : Proto/model conversion utilities
"""

from uniffy.core.errors import (
    AuthenticationError,
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
    UNIFFYError,
    ValidationError,
)
from uniffy.core.types import (
    AccessMode,
    ContentMemberAction,
    ContentRole,
    ContentType,
    NodeType,
    SubjectType,
)

__all__ = [
    # Enums
    "AccessMode",
    "ContentMemberAction",
    "ContentRole",
    "ContentType",
    "NodeType",
    "SubjectType",
    "AuthenticationError",
    "ConflictError",
    "NotFoundError",
    "PermissionDeniedError",
    "UNIFFYError",
    "ValidationError",
]
