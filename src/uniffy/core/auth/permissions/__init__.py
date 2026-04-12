"""
Permission checking utilities for content access control.

This submodule provides:
- :class:`PermissionChecker`: core role resolution (``effective_role``)
- :class:`ContentAccessQuery`: filter builders for list endpoints
- ``role_can_*`` helpers that map a :class:`ContentRole` to capabilities
- ``require_*`` helpers that raise :class:`PermissionDeniedError` when
  the required capability is not granted
- ``record_*`` helpers that append audit events to
  ``permissions_content_member_events``
"""

from uniffy.core.auth.permissions.audit import (
    record_access_mode_changed,
    record_baseline_role_changed,
    record_member_added,
    record_member_removed,
    record_member_role_changed,
    record_ownership_transferred,
)
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.permissions.defaults import resolve_content_defaults
from uniffy.core.auth.permissions.helpers import (
    require_delete,
    require_edit,
    require_manage,
    require_transfer,
    require_view,
)
from uniffy.core.auth.permissions.queries import ContentAccessQuery
from uniffy.core.auth.permissions.roles import (
    MIN_FOR_COMMENT,
    MIN_FOR_DELETE,
    MIN_FOR_EDIT,
    MIN_FOR_MANAGE,
    MIN_FOR_TRANSFER,
    MIN_FOR_VIEW,
    ROLE_ORDINAL,
    max_role,
    role_can_comment,
    role_can_delete,
    role_can_edit,
    role_can_manage,
    role_can_transfer,
    role_can_view,
    role_is_higher_than,
)

__all__ = [
    "ContentAccessQuery",
    "MIN_FOR_COMMENT",
    "MIN_FOR_DELETE",
    "MIN_FOR_EDIT",
    "MIN_FOR_MANAGE",
    "MIN_FOR_TRANSFER",
    "MIN_FOR_VIEW",
    "PermissionChecker",
    "ROLE_ORDINAL",
    "max_role",
    "record_access_mode_changed",
    "record_baseline_role_changed",
    "record_member_added",
    "record_member_removed",
    "record_member_role_changed",
    "record_ownership_transferred",
    "resolve_content_defaults",
    "require_delete",
    "require_edit",
    "require_manage",
    "require_transfer",
    "require_view",
    "role_can_comment",
    "role_can_delete",
    "role_can_edit",
    "role_can_manage",
    "role_can_transfer",
    "role_can_view",
    "role_is_higher_than",
]
