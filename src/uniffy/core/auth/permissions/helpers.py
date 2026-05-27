"""Helpers that raise ``PermissionDeniedError`` when a capability is missing.

Most domain code uses ``BaseContentOperations._require_*`` instead; these
exist for callers checking access outside that flow (e.g. cascade).
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
    """Manage = add/remove members, change access mode or baseline role; needs >= ADMIN."""
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
    """Requires OWNER (org and domain admins bypass at the checker level)."""
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
