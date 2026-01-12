"""
Permission checking utilities for content access control.

This submodule provides:
- PermissionChecker: Core permission checking logic
- ContentAccessQuery: Query builders for filtering accessible content
- Helper functions for requiring permissions
"""

from uwos.core.auth.permissions.checker import PermissionChecker
from uwos.core.auth.permissions.helpers import (
    require_access,
    require_delete,
    require_edit,
    require_share,
)
from uwos.core.auth.permissions.queries import ContentAccessQuery

__all__ = [
    "ContentAccessQuery",
    "PermissionChecker",
    "require_access",
    "require_delete",
    "require_edit",
    "require_share",
]
