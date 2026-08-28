"""Storage quota RPC handlers - thin layer delegating to quota operations."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.files.v1.files_pb2 import (
    CheckStorageQuotaRequest,
    CheckStorageQuotaResponse,
    GetOrgFileVersionPolicyRequest,
    GetOrgFileVersionPolicyResponse,
    GetOrgStorageQuotaRequest,
    GetOrgStorageQuotaResponse,
    GetStorageUsageRequest,
    GetStorageUsageResponse,
    GetUserStorageQuotaRequest,
    GetUserStorageQuotaResponse,
    ListOrgStorageUsageRequest,
    ListOrgStorageUsageResponse,
    ListUserStorageQuotaOverridesRequest,
    ListUserStorageQuotaOverridesResponse,
    OrgFileVersionPolicy,
    RecalculateStorageUsageRequest,
    RecalculateStorageUsageResponse,
    RemoveUserStorageQuotaOverrideRequest,
    RemoveUserStorageQuotaOverrideResponse,
    SetOrgStorageQuotaRequest,
    SetOrgStorageQuotaResponse,
    SetUserStorageQuotaOverrideRequest,
    SetUserStorageQuotaOverrideResponse,
    UpdateOrgFileVersionPolicyRequest,
    UpdateOrgFileVersionPolicyResponse,
)

from uniffy.core.auth.principal import (
    current_user_id,
    resolve_organization_id,
)
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.db import open_session
from uniffy.domains.files.quota.converters import (
    storage_quota_to_proto,
    storage_usage_to_proto,
    user_quota_override_to_proto,
    user_usage_row_to_proto,
)
from uniffy.domains.files.quota.operations import QuotaOperations
from uniffy.domains.files.versions.policy import (
    get_org_version_policy_view,
    update_org_version_policy,
)
from uniffy.domains.organizations.operations import OrganizationOperations

logger = logger.bind(component="files.quota.handlers")


class QuotaHandlersMixin:
    """Storage quota RPC handlers mixed into the files service."""

    async def get_org_storage_quota(
        self,
        request: GetOrgStorageQuotaRequest,
        ctx: RequestContext,
    ) -> GetOrgStorageQuotaResponse:
        """Get the organization storage quota configuration and total usage."""
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)

        try:
            async with open_session() as session:
                await OrganizationOperations(session).require_org_member(user_id, organization_id)
                ops = QuotaOperations(session)
                quota = await ops.get_org_quota(organization_id)
                total_used, total_count = await ops.get_org_usage(organization_id)

                return GetOrgStorageQuotaResponse(
                    quota=storage_quota_to_proto(quota),
                    total_used_bytes=total_used,
                    total_file_count=total_count,
                )

        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error getting org storage quota: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def set_org_storage_quota(
        self,
        request: SetOrgStorageQuotaRequest,
        ctx: RequestContext,
    ) -> SetOrgStorageQuotaResponse:
        """Set or update the organization storage quota configuration."""
        try:
            organization_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = current_user_id()

        try:
            async with open_session() as session:
                ops = QuotaOperations(session)

                org_quota_bytes = None
                if request.HasField("org_quota_bytes"):
                    org_quota_bytes = request.org_quota_bytes

                default_user_quota_bytes = None
                if request.HasField("default_user_quota_bytes"):
                    default_user_quota_bytes = request.default_user_quota_bytes

                warn_at_percent = None
                if request.HasField("warn_at_percent"):
                    warn_at_percent = request.warn_at_percent

                enforce = None
                if request.HasField("enforce"):
                    enforce = request.enforce

                quota = await ops.set_org_quota(
                    user_id=user_id,
                    organization_id=organization_id,
                    org_quota_bytes=org_quota_bytes,
                    default_user_quota_bytes=default_user_quota_bytes,
                    warn_at_percent=warn_at_percent,
                    enforce=enforce,
                )

                return SetOrgStorageQuotaResponse(
                    quota=storage_quota_to_proto(quota),
                )

        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error setting org storage quota: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_user_storage_quota(
        self,
        request: GetUserStorageQuotaRequest,
        ctx: RequestContext,
    ) -> GetUserStorageQuotaResponse:
        """Get a user's effective storage quota and current usage."""
        try:
            organization_id = resolve_organization_id(request.organization_id)
            target_user_id = UUID(request.user_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = current_user_id()

        try:
            async with open_session() as session:
                ops = QuotaOperations(session)

                # Regular users can only view their own quota
                if target_user_id != user_id:
                    await ops._require_admin(user_id, organization_id)

                effective_quota = await ops.get_effective_user_quota(organization_id, target_user_id)
                usage = await ops.get_user_usage(organization_id, target_user_id)
                override = await ops.get_user_quota_override(organization_id, target_user_id)

                usage_percent = 0.0
                if effective_quota is not None and effective_quota > 0:
                    usage_percent = usage.used_bytes / effective_quota * 100

                response = GetUserStorageQuotaResponse(
                    used_bytes=usage.used_bytes,
                    file_count=usage.file_count,
                    usage_percent=usage_percent,
                )

                if effective_quota is not None:
                    response.effective_quota_bytes = effective_quota

                if override:
                    response.override.CopyFrom(user_quota_override_to_proto(override))

                return response

        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error getting user storage quota: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def set_user_storage_quota_override(
        self,
        request: SetUserStorageQuotaOverrideRequest,
        ctx: RequestContext,
    ) -> SetUserStorageQuotaOverrideResponse:
        """Set or update a per-user quota override."""
        try:
            organization_id = resolve_organization_id(request.organization_id)
            target_user_id = UUID(request.user_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = current_user_id()

        try:
            async with open_session() as session:
                ops = QuotaOperations(session)
                override = await ops.set_user_quota_override(
                    admin_user_id=user_id,
                    organization_id=organization_id,
                    user_id=target_user_id,
                    quota_bytes=request.quota_bytes,
                    note=request.note if request.HasField("note") else None,
                )

                return SetUserStorageQuotaOverrideResponse(
                    override=user_quota_override_to_proto(override),
                )

        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error setting user quota override: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def remove_user_storage_quota_override(
        self,
        request: RemoveUserStorageQuotaOverrideRequest,
        ctx: RequestContext,
    ) -> RemoveUserStorageQuotaOverrideResponse:
        """Remove a per-user quota override."""
        try:
            organization_id = resolve_organization_id(request.organization_id)
            target_user_id = UUID(request.user_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = current_user_id()

        try:
            async with open_session() as session:
                ops = QuotaOperations(session)
                await ops.remove_user_quota_override(
                    admin_user_id=user_id,
                    organization_id=organization_id,
                    user_id=target_user_id,
                )

                return RemoveUserStorageQuotaOverrideResponse(success=True)

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "No quota override found for user")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error removing user quota override: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_user_storage_quota_overrides(
        self,
        request: ListUserStorageQuotaOverridesRequest,
        ctx: RequestContext,
    ) -> ListUserStorageQuotaOverridesResponse:
        """List all per-user quota overrides in an organization."""
        try:
            organization_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = current_user_id()

        try:
            async with open_session() as session:
                ops = QuotaOperations(session)
                overrides = await ops.list_user_quota_overrides(
                    admin_user_id=user_id,
                    organization_id=organization_id,
                )

                return ListUserStorageQuotaOverridesResponse(
                    overrides=[user_quota_override_to_proto(o) for o in overrides],
                )

        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error listing user quota overrides: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_storage_usage(
        self,
        request: GetStorageUsageRequest,
        ctx: RequestContext,
    ) -> GetStorageUsageResponse:
        """Get storage usage for a user."""
        try:
            organization_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = current_user_id()

        target_user_id = user_id
        if request.HasField("user_id"):
            try:
                target_user_id = UUID(request.user_id)
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid user_id")

        try:
            async with open_session() as session:
                ops = QuotaOperations(session)

                # Regular users can only view their own usage
                if target_user_id != user_id:
                    await ops._require_admin(user_id, organization_id)

                usage = await ops.get_user_usage(organization_id, target_user_id)
                effective_quota = await ops.get_effective_user_quota(organization_id, target_user_id)
                override = await ops.get_user_quota_override(organization_id, target_user_id)

                return GetStorageUsageResponse(
                    usage=storage_usage_to_proto(
                        usage,
                        effective_quota_bytes=effective_quota,
                        has_override=override is not None,
                    ),
                )

        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error getting storage usage: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_org_storage_usage(
        self,
        request: ListOrgStorageUsageRequest,
        ctx: RequestContext,
    ) -> ListOrgStorageUsageResponse:
        """List storage usage for all users in an organization."""
        try:
            organization_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = current_user_id()

        try:
            async with open_session() as session:
                ops = QuotaOperations(session)
                rows = await ops.list_user_usage(
                    admin_user_id=user_id,
                    organization_id=organization_id,
                )

                total_used = sum(r.used_bytes for r in rows)
                total_count = sum(r.file_count for r in rows)

                return ListOrgStorageUsageResponse(
                    users=[user_usage_row_to_proto(r) for r in rows],
                    total_used_bytes=total_used,
                    total_file_count=total_count,
                )

        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error listing org storage usage: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def recalculate_storage_usage(
        self,
        request: RecalculateStorageUsageRequest,
        ctx: RequestContext,
    ) -> RecalculateStorageUsageResponse:
        """Recalculate storage usage from actual files."""
        try:
            organization_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = current_user_id()

        try:
            async with open_session() as session:
                ops = QuotaOperations(session)
                await ops._require_admin(user_id, organization_id)

                if request.HasField("user_id"):
                    try:
                        target_user_id = UUID(request.user_id)
                    except ValueError:
                        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid user_id")
                    usage = await ops.recalculate_usage(organization_id, target_user_id)
                    usage_list = [usage]
                else:
                    usage_list = await ops.recalculate_org_usage(organization_id)

                proto_recalculated = []
                for usage in usage_list:
                    effective_quota = await ops.get_effective_user_quota(
                        organization_id, usage.user_id
                    )
                    override = await ops.get_user_quota_override(organization_id, usage.user_id)
                    proto_recalculated.append(
                        storage_usage_to_proto(
                            usage,
                            effective_quota_bytes=effective_quota,
                            has_override=override is not None,
                        )
                    )

                return RecalculateStorageUsageResponse(
                    recalculated=proto_recalculated,
                )

        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error recalculating storage usage: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def check_storage_quota(
        self,
        request: CheckStorageQuotaRequest,
        ctx: RequestContext,
    ) -> CheckStorageQuotaResponse:
        """Pre-check whether an upload of a given size is allowed under quota."""
        try:
            organization_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = current_user_id()

        try:
            async with open_session() as session:
                ops = QuotaOperations(session)
                result = await ops.check_quota(
                    organization_id=organization_id,
                    user_id=user_id,
                    additional_bytes=request.additional_bytes,
                )

                response = CheckStorageQuotaResponse(
                    allowed=result.allowed,
                    reason=result.reason,
                    current_used_bytes=result.current_used_bytes,
                    usage_percent=result.usage_percent,
                )

                if result.quota_bytes is not None:
                    response.quota_bytes = result.quota_bytes

                if result.remaining_bytes is not None:
                    response.remaining_bytes = result.remaining_bytes

                return response

        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error checking storage quota: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_org_file_version_policy(
        self,
        request: GetOrgFileVersionPolicyRequest,
        ctx: RequestContext,
    ) -> GetOrgFileVersionPolicyResponse:
        """Effective version retention policy for the admin surface."""
        try:
            organization_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = current_user_id()

        try:
            async with open_session() as session:
                policy = await get_org_version_policy_view(session, user_id, organization_id)
                return GetOrgFileVersionPolicyResponse(
                    policy=OrgFileVersionPolicy(
                        organization_id=str(policy.organization_id),
                        keep_versions=policy.keep_versions,
                    )
                )

        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error getting file version policy: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_org_file_version_policy(
        self,
        request: UpdateOrgFileVersionPolicyRequest,
        ctx: RequestContext,
    ) -> UpdateOrgFileVersionPolicyResponse:
        try:
            organization_id = resolve_organization_id(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = current_user_id()

        try:
            async with open_session() as session:
                policy = await update_org_version_policy(
                    session,
                    user_id,
                    organization_id,
                    keep_versions=request.keep_versions,
                )
                return UpdateOrgFileVersionPolicyResponse(
                    policy=OrgFileVersionPolicy(
                        organization_id=str(policy.organization_id),
                        keep_versions=policy.keep_versions,
                    )
                )

        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError:
            raise ConnectError(Code.PERMISSION_DENIED, "Access denied")
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error updating file version policy: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")
