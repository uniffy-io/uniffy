"""Shared utilities, base classes, and infrastructure used by all domains."""

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
