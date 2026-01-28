"""
Permission helper functions for requiring access.

Provides convenience functions and decorators for common
permission checking patterns.
"""

from uuid import UUID

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.errors import PermissionDeniedError
from uniffy.core.types import ContentType, VisibilityScope


async def require_access(
    checker: PermissionChecker,
    user_id: UUID,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
    content_owner_id: UUID,
    content_visibility: VisibilityScope,
    error_message: str | None = None,
) -> None:
    """
    Require that a user can access content, raising PermissionDeniedError if not.

    Parameters
    ----------
    checker : PermissionChecker
        Permission checker instance.
    user_id : UUID
        User attempting to access.
    organization_id : UUID
        Organization ID.
    content_type : ContentType
        Type of content.
    content_id : UUID
        ID of the content.
    content_owner_id : UUID
        Owner of the content.
    content_visibility : VisibilityScope
        Visibility of the content.
    error_message : str | None
        Custom error message.

    Raises
    ------
    PermissionDeniedError
        If user cannot access the content.

    """
    can_access = await checker.can_access_content(
        user_id=user_id,
        organization_id=organization_id,
        content_type=content_type,
        content_id=content_id,
        content_owner_id=content_owner_id,
        content_visibility=content_visibility,
    )
    if not can_access:
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
    content_owner_id: UUID,
    content_visibility: VisibilityScope,
    error_message: str | None = None,
) -> None:
    """
    Require that a user can edit content, raising PermissionDeniedError if not.

    Parameters
    ----------
    checker : PermissionChecker
        Permission checker instance.
    user_id : UUID
        User attempting to edit.
    organization_id : UUID
        Organization ID.
    content_type : ContentType
        Type of content.
    content_id : UUID
        ID of the content.
    content_owner_id : UUID
        Owner of the content.
    content_visibility : VisibilityScope
        Visibility of the content.
    error_message : str | None
        Custom error message.

    Raises
    ------
    PermissionDeniedError
        If user cannot edit the content.

    """
    can_edit = await checker.can_edit_content(
        user_id=user_id,
        organization_id=organization_id,
        content_type=content_type,
        content_id=content_id,
        content_owner_id=content_owner_id,
        content_visibility=content_visibility,
    )
    if not can_edit:
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
    content_owner_id: UUID,
    error_message: str | None = None,
) -> None:
    """
    Require that a user can delete content, raising PermissionDeniedError if not.

    Parameters
    ----------
    checker : PermissionChecker
        Permission checker instance.
    user_id : UUID
        User attempting to delete.
    organization_id : UUID
        Organization ID.
    content_type : ContentType
        Type of content.
    content_id : UUID
        ID of the content.
    content_owner_id : UUID
        Owner of the content.
    error_message : str | None
        Custom error message.

    Raises
    ------
    PermissionDeniedError
        If user cannot delete the content.

    """
    can_delete = await checker.can_delete_content(
        user_id=user_id,
        organization_id=organization_id,
        content_type=content_type,
        content_id=content_id,
        content_owner_id=content_owner_id,
    )
    if not can_delete:
        raise PermissionDeniedError(
            action="delete",
            resource=error_message or content_type.value,
        )


async def require_share(
    checker: PermissionChecker,
    user_id: UUID,
    organization_id: UUID,
    content_type: ContentType,
    content_id: UUID,
    content_owner_id: UUID,
    error_message: str | None = None,
) -> None:
    """
    Require that a user can share content, raising PermissionDeniedError if not.

    Parameters
    ----------
    checker : PermissionChecker
        Permission checker instance.
    user_id : UUID
        User attempting to share.
    organization_id : UUID
        Organization ID.
    content_type : ContentType
        Type of content.
    content_id : UUID
        ID of the content.
    content_owner_id : UUID
        Owner of the content.
    error_message : str | None
        Custom error message.

    Raises
    ------
    PermissionDeniedError
        If user cannot share the content.

    """
    can_share = await checker.can_share_content(
        user_id=user_id,
        organization_id=organization_id,
        content_type=content_type,
        content_id=content_id,
        content_owner_id=content_owner_id,
    )
    if not can_share:
        raise PermissionDeniedError(
            action="share",
            resource=error_message or content_type.value,
        )
