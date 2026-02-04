"""Permissions RPC handlers - thin layer delegating to operations."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.db import get_async_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.permissions.converters import (
    get_permission_flags_from_level,
    group_to_share_target,
    permission_to_proto,
    proto_to_content_type,
    proto_to_permission_level,
    proto_to_subject_type,
    user_to_share_target,
)
from uniffy.domains.permissions.operations import PermissionsOperations
from uniffy.gen.permissions.v1.permissions_pb2 import (
    GetMyPermissionRequest,
    GrantPermissionRequest,
    ListContentPermissionsRequest,
    PermissionInfo,
    PermissionListResponse,
    RevokePermissionRequest,
    RevokePermissionResponse,
    SearchShareTargetsRequest,
    ShareTargetsResponse,
    UpdatePermissionRequest,
)


class PermissionsHandlers:
    """RPC handlers for permissions service."""

    async def grant_permission(
        self,
        request: GrantPermissionRequest,
        ctx: RequestContext,
    ) -> PermissionInfo:
        """
        Handle grant_permission RPC call.

        Grants permission to a user or group on content.

        Parameters
        ----------
        request : GrantPermissionRequest
            The grant request.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        PermissionInfo
            The created permission.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            organization_id = UUID(request.organization_id)
            content_id = UUID(request.content_id)
            subject_id = UUID(request.subject_id)
        except ValueError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid UUID format: {e}")

        content_type = proto_to_content_type(request.content_type)
        if content_type is None:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid content type")

        subject_type = proto_to_subject_type(request.subject_type)
        if subject_type is None:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid subject type")

        permission_level = proto_to_permission_level(request.level)
        flags = get_permission_flags_from_level(request.level)

        # Parse optional expiration
        expires_at = None
        if request.HasField("expires_at"):
            expires_at = request.expires_at.ToDatetime()

        try:
            async for session in get_async_session():
                ops = PermissionsOperations(session)

                # Get the actual content owner
                actual_owner_id = await ops._get_content_owner_id(content_type, content_id)
                if not actual_owner_id:
                    raise ConnectError(Code.NOT_FOUND, "Content not found")

                permission = await ops.grant_permission(
                    granted_by_user_id=user_id,
                    organization_id=organization_id,
                    content_type=content_type,
                    content_id=content_id,
                    content_owner_id=actual_owner_id,
                    subject_type=subject_type,
                    subject_id=subject_id,
                    permission_level=permission_level,
                    **flags,
                    expires_at=expires_at,
                )

                # Get subject info
                subject, member_count = await ops.get_permission_subject(permission)
                granted_by = await ops.get_user_by_id(user_id)

                return permission_to_proto(
                    permission,
                    subject=subject,
                    granted_by=granted_by,
                    member_count=member_count,
                )

        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "You cannot share this content")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error granting permission: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def revoke_permission(
        self,
        request: RevokePermissionRequest,
        ctx: RequestContext,
    ) -> RevokePermissionResponse:
        """
        Handle revoke_permission RPC call.

        Revokes a permission.

        Parameters
        ----------
        request : RevokePermissionRequest
            The revoke request.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        RevokePermissionResponse
            Success flag.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            organization_id = UUID(request.organization_id)
            permission_id = UUID(request.permission_id)
        except ValueError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid UUID format: {e}")

        try:
            async for session in get_async_session():
                ops = PermissionsOperations(session)

                # Fetch permission to get content info
                existing_permission = await ops.get_permission_by_id(permission_id)
                if not existing_permission:
                    raise ConnectError(Code.NOT_FOUND, "Permission not found")

                # Get the actual content owner
                actual_owner_id = await ops._get_content_owner_id(
                    existing_permission.content_type,
                    existing_permission.content_id,
                )
                if not actual_owner_id:
                    raise ConnectError(Code.NOT_FOUND, "Content not found")

                success = await ops.revoke_permission(
                    revoking_user_id=user_id,
                    organization_id=organization_id,
                    permission_id=permission_id,
                    content_owner_id=actual_owner_id,
                )
                return RevokePermissionResponse(success=success)

        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "You cannot revoke this permission")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error revoking permission: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_permission(
        self,
        request: UpdatePermissionRequest,
        ctx: RequestContext,
    ) -> PermissionInfo:
        """
        Handle update_permission RPC call.

        Updates a permission.

        Parameters
        ----------
        request : UpdatePermissionRequest
            The update request.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        PermissionInfo
            The updated permission.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            organization_id = UUID(request.organization_id)
            permission_id = UUID(request.permission_id)
        except ValueError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid UUID format: {e}")

        permission_level = None
        if request.HasField("level"):
            permission_level = proto_to_permission_level(request.level)

        expires_at = None
        if request.HasField("expires_at"):
            expires_at = request.expires_at.ToDatetime()

        try:
            async for session in get_async_session():
                ops = PermissionsOperations(session)

                # Fetch permission to get content info
                existing_permission = await ops.get_permission_by_id(permission_id)
                if not existing_permission:
                    raise ConnectError(Code.NOT_FOUND, "Permission not found")

                # Get the actual content owner
                actual_owner_id = await ops._get_content_owner_id(
                    existing_permission.content_type,
                    existing_permission.content_id,
                )
                if not actual_owner_id:
                    raise ConnectError(Code.NOT_FOUND, "Content not found")

                permission = await ops.update_permission(
                    updating_user_id=user_id,
                    organization_id=organization_id,
                    permission_id=permission_id,
                    content_owner_id=actual_owner_id,
                    permission_level=permission_level,
                    expires_at=expires_at,
                    clear_expiration=request.clear_expiration,
                )

                # Get subject info
                subject, member_count = await ops.get_permission_subject(permission)
                granted_by = await ops.get_user_by_id(permission.granted_by_user_id)

                return permission_to_proto(
                    permission,
                    subject=subject,
                    granted_by=granted_by,
                    member_count=member_count,
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Permission not found")
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "You cannot update this permission")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error updating permission: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_content_permissions(
        self,
        request: ListContentPermissionsRequest,
        ctx: RequestContext,
    ) -> PermissionListResponse:
        """
        Handle list_content_permissions RPC call.

        Lists all permissions for a piece of content.

        Parameters
        ----------
        request : ListContentPermissionsRequest
            The list request.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        PermissionListResponse
            List of permissions and owner.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            organization_id = UUID(request.organization_id)
            content_id = UUID(request.content_id)
        except ValueError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid UUID format: {e}")

        content_type = proto_to_content_type(request.content_type)
        if content_type is None:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid content type")

        try:
            async for session in get_async_session():
                ops = PermissionsOperations(session)
                permissions, owner = await ops.list_content_permissions(
                    user_id=user_id,
                    organization_id=organization_id,
                    content_type=content_type,
                    content_id=content_id,
                    content_owner_id=user_id,  # Not used in list
                )

                response = PermissionListResponse()

                if owner:
                    response.owner.CopyFrom(user_to_share_target(owner))

                for permission in permissions:
                    subject, member_count = await ops.get_permission_subject(permission)
                    granted_by = await ops.get_user_by_id(permission.granted_by_user_id)
                    proto = permission_to_proto(
                        permission,
                        subject=subject,
                        granted_by=granted_by,
                        member_count=member_count,
                    )
                    response.permissions.append(proto)

                return response

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing permissions: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_my_permission(
        self,
        request: GetMyPermissionRequest,
        ctx: RequestContext,
    ) -> PermissionInfo:
        """
        Handle get_my_permission RPC call.

        Gets the current user's permission on content.

        Parameters
        ----------
        request : GetMyPermissionRequest
            The request.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        PermissionInfo
            The permission info.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            organization_id = UUID(request.organization_id)
            content_id = UUID(request.content_id)
        except ValueError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid UUID format: {e}")

        content_type = proto_to_content_type(request.content_type)
        if content_type is None:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid content type")

        try:
            async for session in get_async_session():
                ops = PermissionsOperations(session)
                permission = await ops.get_my_permission(
                    user_id=user_id,
                    organization_id=organization_id,
                    content_type=content_type,
                    content_id=content_id,
                )

                if not permission:
                    # Return empty permission info
                    return PermissionInfo()

                subject = await ops.get_user_by_id(user_id)
                granted_by = await ops.get_user_by_id(permission.granted_by_user_id)

                return permission_to_proto(
                    permission,
                    subject=subject,
                    granted_by=granted_by,
                )

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting my permission: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def search_share_targets(
        self,
        request: SearchShareTargetsRequest,
        ctx: RequestContext,
    ) -> ShareTargetsResponse:
        """
        Handle search_share_targets RPC call.

        Searches for users and groups to share with.

        Parameters
        ----------
        request : SearchShareTargetsRequest
            The search request.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        ShareTargetsResponse
            List of share targets.

        """
        get_user_id_from_context(ctx)  # Ensure authenticated

        try:
            organization_id = UUID(request.organization_id)
        except ValueError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid UUID format: {e}")

        limit = request.limit if request.limit > 0 else 10
        limit = min(limit, 50)  # Cap at 50

        # Default to including both if not specified
        include_users = request.include_users if request.include_users else True
        include_groups = request.include_groups if request.include_groups else True

        try:
            async for session in get_async_session():
                ops = PermissionsOperations(session)
                results = await ops.search_share_targets(
                    organization_id=organization_id,
                    query=request.query,
                    limit=limit,
                    include_users=include_users,
                    include_groups=include_groups,
                )

                response = ShareTargetsResponse()
                from uniffy.core.models import Group, User

                for target, member_count in results:
                    if isinstance(target, User):
                        response.targets.append(user_to_share_target(target))
                    elif isinstance(target, Group):
                        response.targets.append(
                            group_to_share_target(target, member_count)
                        )

                return response

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error searching share targets: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")
