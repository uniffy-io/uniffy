"""
Permission helper functions for requiring access.

Thin wrappers around :meth:`PermissionChecker.effective_role` that raise
:class:`PermissionDeniedError` when the required capability is not
granted. Most code should use :class:`BaseContentOperations`' built-in
``_require_*`` methods instead of calling these directly; they exist for
code that checks access outside the base-operations flow (e.g. the
cascade module).
"""

from uuid import UUID

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.permissions.roles import (
    role_can_delete,
    role_can_edit,
    role_can_manage,
    role_can_transfer,
    role_can_view,
)
from uniffy.core.errors import PermissionDeniedError
from uniffy.core.types import AccessMode, ContentRole, ContentType


async def require_view(
    checker: PermissionChecker,
    user_id: UUID,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
    *,
    owner_id: UUID,
    access_mode: AccessMode,
    baseline_role: ContentRole | None,
    error_message: str | None = None,
) -> None:
    """Raise ``PermissionDeniedError`` unless the user can view the content."""
    role = await checker.effective_role(
        user_id=user_id,
        organization_id=organization_id,
        content_type=content_type,
        content_id=content_id,
        owner_id=owner_id,
        access_mode=access_mode,
        baseline_role=baseline_role,
    )
    if not role_can_view(role):
        raise PermissionDeniedError(
            action="access",
            resource=error_message or content_type.value,
        )


async def require_edit(
    checker: PermissionChecker,
    user_id: UUID,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
    *,
    owner_id: UUID,
    access_mode: AccessMode,
    baseline_role: ContentRole | None,
    error_message: str | None = None,
) -> None:
    """Raise ``PermissionDeniedError`` unless the user can edit the content."""
    role = await checker.effective_role(
        user_id=user_id,
        organization_id=organization_id,
        content_type=content_type,
        content_id=content_id,
        owner_id=owner_id,
        access_mode=access_mode,
        baseline_role=baseline_role,
    )
    if not role_can_edit(role):
        raise PermissionDeniedError(
            action="edit",
            resource=error_message or content_type.value,
        )


async def require_delete(
    checker: PermissionChecker,
    user_id: UUID,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
    *,
    owner_id: UUID,
    access_mode: AccessMode,
    baseline_role: ContentRole | None,
    error_message: str | None = None,
) -> None:
    """Raise ``PermissionDeniedError`` unless the user can delete the content."""
    role = await checker.effective_role(
        user_id=user_id,
        organization_id=organization_id,
        content_type=content_type,
        content_id=content_id,
        owner_id=owner_id,
        access_mode=access_mode,
        baseline_role=baseline_role,
    )
    if not role_can_delete(role):
        raise PermissionDeniedError(
            action="delete",
            resource=error_message or content_type.value,
        )


async def require_manage(
    checker: PermissionChecker,
    user_id: UUID,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
    *,
    owner_id: UUID,
    access_mode: AccessMode,
    baseline_role: ContentRole | None,
    error_message: str | None = None,
) -> None:
    """Raise ``PermissionDeniedError`` unless the user can manage the content.

    Managing covers: adding / removing members, changing access mode,
    changing baseline role. Requires at least ADMIN.
    """
    role = await checker.effective_role(
        user_id=user_id,
        organization_id=organization_id,
        content_type=content_type,
        content_id=content_id,
        owner_id=owner_id,
        access_mode=access_mode,
        baseline_role=baseline_role,
    )
    if not role_can_manage(role):
        raise PermissionDeniedError(
            action="manage",
            resource=error_message or content_type.value,
        )


async def require_transfer(
    checker: PermissionChecker,
    user_id: UUID,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
    *,
    owner_id: UUID,
    access_mode: AccessMode,
    baseline_role: ContentRole | None,
    error_message: str | None = None,
) -> None:
    """Raise ``PermissionDeniedError`` unless the user can transfer ownership.

    Requires the OWNER role (org and domain admins bypass at the checker
    level).
    """
    role = await checker.effective_role(
        user_id=user_id,
        organization_id=organization_id,
        content_type=content_type,
        content_id=content_id,
        owner_id=owner_id,
        access_mode=access_mode,
        baseline_role=baseline_role,
    )
    if not role_can_transfer(role):
        raise PermissionDeniedError(
            action="transfer",
            resource=error_message or content_type.value,
        )
