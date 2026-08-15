from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from sqlalchemy import select
from uniffy_proto.common.v1.common_pb2 import (
    PaginationResponse,
)
from uniffy_proto.organizations.v1.organizations_pb2 import (
    AddMemberRequest,
    AddMemberResponse,
    GetOrganizationOverviewRequest,
    GetOrganizationOverviewResponse,
    GetOrganizationRequest,
    GetOrganizationResponse,
    GetOrganizationSettingsRequest,
    GetOrganizationSettingsResponse,
    GetPermissionDefaultsRequest,
    GetPermissionDefaultsResponse,
    GetSecuritySettingsRequest,
    GetSecuritySettingsResponse,
    GetUserDomainAdminsRequest,
    GetUserDomainAdminsResponse,
    GrantDomainAdminRequest,
    GrantDomainAdminResponse,
    InvitationStatus,
    InviteMemberRequest,
    InviteMemberResponse,
    ListDomainAdminsRequest,
    ListDomainAdminsResponse,
    ListInvitationsRequest,
    ListInvitationsResponse,
    ListMembersRequest,
    ListMembersResponse,
    ListMyOrganizationsRequest,
    ListMyOrganizationsResponse,
    RemoveMemberRequest,
    RemoveMemberResponse,
    ResendInvitationRequest,
    ResendInvitationResponse,
    RevokeDomainAdminRequest,
    RevokeDomainAdminResponse,
    RevokeInvitationRequest,
    RevokeInvitationResponse,
    RotateEncryptionKeyRequest,
    RotateEncryptionKeyResponse,
    UpdateMemberRoleRequest,
    UpdateMemberRoleResponse,
    UpdateOrganizationRequest,
    UpdateOrganizationResponse,
    UpdateOrganizationSettingsRequest,
    UpdateOrganizationSettingsResponse,
    UpdatePermissionDefaultsRequest,
    UpdatePermissionDefaultsResponse,
    UpdateSecuritySettingsRequest,
    UpdateSecuritySettingsResponse,
)
from uniffy_proto.organizations.v1.organizations_pb2 import (
    SecuritySettings as SecuritySettingsProto,
)

from uniffy.core.converters import (
    content_type_from_proto,
    datetime_to_timestamp,
    domain_admin_info_to_proto,
    domain_type_from_proto,
    domain_type_to_proto,
    member_info_to_proto,
    org_info_to_proto,
    org_role_from_proto,
)
from uniffy.core.converters.common_proto import (
    access_mode_from_proto,
    content_role_from_proto,
)
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.db import open_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.invitations.converters import invitation_to_proto
from uniffy.domains.invitations.errors import (
    InvitationAlreadyUsedError,
    InvitationRevokedError,
)
from uniffy.domains.invitations.operations import (
    InvitationOperations,
    InviteOutcome,
)
from uniffy.domains.organizations.converters import (
    my_organization_to_proto,
    organization_detail_to_proto,
    organization_overview_to_proto,
    organization_settings_to_proto,
    permission_defaults_to_proto,
)
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.security.operations import SecurityOperations

logger = logger.bind(component="organizations.handlers")


class OrganizationsHandlers:
    async def list_my_organizations(
        self,
        request: ListMyOrganizationsRequest,
        ctx: RequestContext,
    ) -> ListMyOrganizationsResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            async with open_session() as session:
                ops = OrganizationOperations(session)
                orgs_with_memberships = await ops.get_user_organizations(user_id)

                return ListMyOrganizationsResponse(
                    organizations=[
                        my_organization_to_proto(org, membership)
                        for org, membership in orgs_with_memberships
                    ]
                )
        except Exception as e:
            logger.exception(f"Error listing user organizations: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_organization(
        self,
        request: GetOrganizationRequest,
        ctx: RequestContext,
    ) -> GetOrganizationResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        try:
            async with open_session() as session:
                ops = OrganizationOperations(session)
                await ops.require_org_member(user_id, org_id)

                overview = await ops.get_overview(org_id)
                org = overview["organization"]

                return GetOrganizationResponse(
                    organization=organization_detail_to_proto(
                        org,
                        overview["member_count"],
                        overview["group_count"],
                    )
                )
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.exception(f"Error getting organization: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_organization(
        self,
        request: UpdateOrganizationRequest,
        ctx: RequestContext,
    ) -> UpdateOrganizationResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        try:
            async with open_session() as session:
                ops = OrganizationOperations(session)
                await ops.require_org_admin(user_id, org_id)

                org = await ops.update(
                    org_id=org_id,
                    name=request.name if request.HasField("name") else None,
                    slug=request.slug if request.HasField("slug") else None,
                    is_active=request.is_active if request.HasField("is_active") else None,
                    actor_user_id=user_id,
                )

                return UpdateOrganizationResponse(organization=org_info_to_proto(org))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.exception(f"Error updating organization: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_organization_overview(
        self,
        request: GetOrganizationOverviewRequest,
        ctx: RequestContext,
    ) -> GetOrganizationOverviewResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        try:
            async with open_session() as session:
                ops = OrganizationOperations(session)
                await ops.require_org_admin(user_id, org_id)

                overview = await ops.get_overview(org_id)

                return GetOrganizationOverviewResponse(
                    overview=organization_overview_to_proto(
                        overview["organization"],
                        overview["member_count"],
                        overview["group_count"],
                    )
                )
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.exception(f"Error getting organization overview: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_members(
        self,
        request: ListMembersRequest,
        ctx: RequestContext,
    ) -> ListMembersResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        try:
            async with open_session() as session:
                ops = OrganizationOperations(session)
                await ops.require_org_member(user_id, org_id)

                page = 1
                page_size = 50
                if request.HasField("pagination"):
                    page = request.pagination.page if request.pagination.page > 0 else 1
                    page_size = (
                        request.pagination.page_size if request.pagination.page_size > 0 else 50
                    )

                role_filter = None
                if request.HasField("role_filter"):
                    role_filter = org_role_from_proto(request.role_filter)

                members, total = await ops.list_members(
                    org_id=org_id,
                    page=page,
                    page_size=page_size,
                    role_filter=role_filter,
                    search=request.search if request.HasField("search") else None,
                    include_inactive=(
                        request.include_inactive if request.HasField("include_inactive") else False
                    ),
                )

                total_pages = (total + page_size - 1) // page_size

                return ListMembersResponse(
                    members=[member_info_to_proto(user, membership) for membership, user in members],
                    pagination=PaginationResponse(
                        page=page,
                        page_size=page_size,
                        total_count=total,
                        total_pages=total_pages,
                    ),
                )
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.exception(f"Error listing members: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def add_member(
        self,
        request: AddMemberRequest,
        ctx: RequestContext,
    ) -> AddMemberResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            target_user_id = UUID(request.user_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id or user_id")

        try:
            async with open_session() as session:
                ops = OrganizationOperations(session)
                await ops.require_org_admin(user_id, org_id)

                role = org_role_from_proto(request.role)
                if role is None:
                    role = OrganizationRole.MEMBER

                from uniffy.domains.users.operations import UserOperations as _UserOps

                user_ops = _UserOps(session)
                target_user = await user_ops.get_by_id(target_user_id)

                membership = await ops.add_member(
                    target_user_id, org_id, role, actor_user_id=user_id
                )

                return AddMemberResponse(member=member_info_to_proto(target_user, membership))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.exception(f"Error adding member: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_member_role(
        self,
        request: UpdateMemberRoleRequest,
        ctx: RequestContext,
    ) -> UpdateMemberRoleResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            target_user_id = UUID(request.user_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id or user_id")

        try:
            async with open_session() as session:
                ops = OrganizationOperations(session)

                new_role = org_role_from_proto(request.role)
                if new_role is None:
                    raise ConnectError(Code.INVALID_ARGUMENT, "Invalid role")

                membership, target_user = await ops.update_member_role(
                    admin_user_id=user_id,
                    org_id=org_id,
                    target_user_id=target_user_id,
                    new_role=new_role,
                )

                return UpdateMemberRoleResponse(member=member_info_to_proto(target_user, membership))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.exception(f"Error updating member role: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def remove_member(
        self,
        request: RemoveMemberRequest,
        ctx: RequestContext,
    ) -> RemoveMemberResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            target_user_id = UUID(request.user_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id or user_id")

        try:
            async with open_session() as session:
                ops = OrganizationOperations(session)

                await ops.remove_member(
                    admin_user_id=user_id,
                    org_id=org_id,
                    target_user_id=target_user_id,
                )

                return RemoveMemberResponse(success=True)
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.exception(f"Error removing member: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_permission_defaults(
        self,
        request: GetPermissionDefaultsRequest,
        ctx: RequestContext,
    ) -> GetPermissionDefaultsResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        try:
            async with open_session() as session:
                ops = OrganizationOperations(session)
                await ops.require_org_admin(user_id, org_id)

                defaults = await ops.get_permission_defaults(org_id)

                return GetPermissionDefaultsResponse(
                    defaults=[permission_defaults_to_proto(d) for d in defaults]
                )
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except Exception as e:
            logger.exception(f"Error getting permission defaults: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_permission_defaults(
        self,
        request: UpdatePermissionDefaultsRequest,
        ctx: RequestContext,
    ) -> UpdatePermissionDefaultsResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        content_type = content_type_from_proto(request.content_type)
        if content_type is None:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid content_type")

        try:
            async with open_session() as session:
                ops = OrganizationOperations(session)

                default_access_mode = None
                if request.HasField("default_access_mode"):
                    default_access_mode = access_mode_from_proto(request.default_access_mode)

                default_baseline_role = None
                if request.HasField("default_baseline_role"):
                    default_baseline_role = content_role_from_proto(request.default_baseline_role)

                defaults = await ops.update_permission_defaults(
                    user_id=user_id,
                    org_id=org_id,
                    content_type=content_type,
                    default_access_mode=default_access_mode,
                    default_baseline_role=default_baseline_role,
                )

                return UpdatePermissionDefaultsResponse(
                    defaults=permission_defaults_to_proto(defaults)
                )
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except Exception as e:
            logger.exception(f"Error updating permission defaults: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_organization_settings(
        self,
        request: GetOrganizationSettingsRequest,
        ctx: RequestContext,
    ) -> GetOrganizationSettingsResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        try:
            async with open_session() as session:
                ops = OrganizationOperations(session)
                await ops.require_org_admin(user_id, org_id)
                settings = await ops.get_organization_settings(org_id)
                return GetOrganizationSettingsResponse(
                    settings=organization_settings_to_proto(settings)
                )
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.exception(f"Error getting organization settings: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_organization_settings(
        self,
        request: UpdateOrganizationSettingsRequest,
        ctx: RequestContext,
    ) -> UpdateOrganizationSettingsResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        chat_agents_enabled: bool | None = None
        if request.HasField("chat"):
            chat_agents_enabled = request.chat.agents_enabled

        try:
            async with open_session() as session:
                ops = OrganizationOperations(session)
                settings = await ops.update_organization_settings(
                    user_id=user_id,
                    org_id=org_id,
                    chat_agents_enabled=chat_agents_enabled,
                )
                return UpdateOrganizationSettingsResponse(
                    settings=organization_settings_to_proto(settings)
                )
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.exception(f"Error updating organization settings: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def grant_domain_admin(
        self,
        request: GrantDomainAdminRequest,
        ctx: RequestContext,
    ) -> GrantDomainAdminResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            target_user_id = UUID(request.user_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id or user_id")

        domain = domain_type_from_proto(request.domain)
        if domain is None:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid domain")

        try:
            async with open_session() as session:
                ops = OrganizationOperations(session)
                da, target_user = await ops.grant_domain_admin(
                    admin_user_id=user_id,
                    org_id=org_id,
                    target_user_id=target_user_id,
                    domain=domain,
                )
                return GrantDomainAdminResponse(
                    domain_admin=domain_admin_info_to_proto(da, target_user)
                )
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.exception(f"Error granting domain admin: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def revoke_domain_admin(
        self,
        request: RevokeDomainAdminRequest,
        ctx: RequestContext,
    ) -> RevokeDomainAdminResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            target_user_id = UUID(request.user_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id or user_id")

        domain = domain_type_from_proto(request.domain)
        if domain is None:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid domain")

        try:
            async with open_session() as session:
                ops = OrganizationOperations(session)
                await ops.revoke_domain_admin(
                    admin_user_id=user_id,
                    org_id=org_id,
                    target_user_id=target_user_id,
                    domain=domain,
                )
                return RevokeDomainAdminResponse(success=True)
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.exception(f"Error revoking domain admin: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_domain_admins(
        self,
        request: ListDomainAdminsRequest,
        ctx: RequestContext,
    ) -> ListDomainAdminsResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        try:
            async with open_session() as session:
                ops = OrganizationOperations(session)
                await ops.require_org_admin(user_id, org_id)

                domain_filter = None
                if request.HasField("domain_filter"):
                    domain_filter = domain_type_from_proto(request.domain_filter)

                page = 1
                page_size = 50
                if request.HasField("pagination"):
                    page = request.pagination.page if request.pagination.page > 0 else 1
                    page_size = (
                        request.pagination.page_size if request.pagination.page_size > 0 else 50
                    )

                items, total = await ops.list_domain_admins(
                    org_id=org_id,
                    domain_filter=domain_filter,
                    page=page,
                    page_size=page_size,
                )

                total_pages = (total + page_size - 1) // page_size

                return ListDomainAdminsResponse(
                    domain_admins=[domain_admin_info_to_proto(da, user) for da, user in items],
                    pagination=PaginationResponse(
                        page=page,
                        page_size=page_size,
                        total_count=total,
                        total_pages=total_pages,
                    ),
                )
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except Exception as e:
            logger.exception(f"Error listing domain admins: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_user_domain_admins(
        self,
        request: GetUserDomainAdminsRequest,
        ctx: RequestContext,
    ) -> GetUserDomainAdminsResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            target_user_id = UUID(request.user_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id or user_id")

        try:
            async with open_session() as session:
                ops = OrganizationOperations(session)

                if user_id != target_user_id:
                    await ops.require_org_admin(user_id, org_id)
                else:
                    await ops.require_org_member(user_id, org_id)

                domains = await ops.get_user_domain_admins(org_id, target_user_id)
                return GetUserDomainAdminsResponse(
                    domains=[domain_type_to_proto(d) for d in domains],
                )
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.exception(f"Error getting user domain admins: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def rotate_encryption_key(
        self,
        request: RotateEncryptionKeyRequest,
        ctx: RequestContext,
    ) -> RotateEncryptionKeyResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        try:
            async with open_session() as session:
                ops = OrganizationOperations(session)
                previous_version, new_version, rotated_at = await ops.rotate_encryption_key(
                    user_id, org_id
                )
                return RotateEncryptionKeyResponse(
                    new_version=new_version,
                    previous_version=previous_version,
                    rotated_at=datetime_to_timestamp(rotated_at),
                )
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.exception(f"Error rotating encryption key: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def invite_member(
        self,
        request: InviteMemberRequest,
        ctx: RequestContext,
    ) -> InviteMemberResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")
        role = org_role_from_proto(request.role) or OrganizationRole.MEMBER

        try:
            async with open_session() as session:
                ops = InvitationOperations(session)
                result = await ops.invite(
                    org_id=org_id,
                    email=request.email,
                    role=role,
                    inviter_id=user_id,
                )
                if result.outcome == InviteOutcome.ADDED:
                    assert result.member is not None and result.member_user is not None
                    return InviteMemberResponse(
                        added_member=member_info_to_proto(result.member_user, result.member)
                    )
                assert result.invitation is not None
                inviter_row = (
                    await session.execute(select(User).where(User.id == user_id))
                ).scalar_one_or_none()
                return InviteMemberResponse(
                    invitation=invitation_to_proto(result.invitation, inviter_row)
                )
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except ValueError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except Exception as e:
            logger.exception(f"Error inviting member: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_invitations(
        self,
        request: ListInvitationsRequest,
        ctx: RequestContext,
    ) -> ListInvitationsResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        try:
            async with open_session() as session:
                ops = InvitationOperations(session)
                rows = await ops.list_for_org(org_id, actor_id=user_id)
                protos = [invitation_to_proto(inv, inviter) for inv, inviter in rows]
                if request.HasField("status"):
                    wanted: InvitationStatus.ValueType = request.status
                    protos = [p for p in protos if p.status == wanted]
                return ListInvitationsResponse(invitations=protos)
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.exception(f"Error listing invitations: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def revoke_invitation(
        self,
        request: RevokeInvitationRequest,
        ctx: RequestContext,
    ) -> RevokeInvitationResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            invitation_id = UUID(request.invitation_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid invitation_id")
        try:
            async with open_session() as session:
                ops = InvitationOperations(session)
                invitation = await ops.revoke(invitation_id, actor_id=user_id)
                inviter = (
                    await session.execute(
                        select(User).where(User.id == invitation.invited_by_user_id)
                    )
                ).scalar_one_or_none()
                return RevokeInvitationResponse(invitation=invitation_to_proto(invitation, inviter))
        except InvitationAlreadyUsedError as e:
            raise ConnectError(Code.FAILED_PRECONDITION, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.exception(f"Error revoking invitation: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def resend_invitation(
        self,
        request: ResendInvitationRequest,
        ctx: RequestContext,
    ) -> ResendInvitationResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            invitation_id = UUID(request.invitation_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid invitation_id")
        try:
            async with open_session() as session:
                ops = InvitationOperations(session)
                invitation = await ops.resend(invitation_id, actor_id=user_id)
                inviter = (
                    await session.execute(
                        select(User).where(User.id == invitation.invited_by_user_id)
                    )
                ).scalar_one_or_none()
                return ResendInvitationResponse(invitation=invitation_to_proto(invitation, inviter))
        except (InvitationAlreadyUsedError, InvitationRevokedError) as e:
            raise ConnectError(Code.FAILED_PRECONDITION, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.exception(f"Error resending invitation: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_security_settings(
        self,
        request: GetSecuritySettingsRequest,
        ctx: RequestContext,
    ) -> GetSecuritySettingsResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")
        try:
            async with open_session() as session:
                org_ops = OrganizationOperations(session)
                await org_ops.require_org_admin(user_id, org_id)
                settings = await SecurityOperations(session).get(org_id)
                return GetSecuritySettingsResponse(
                    settings=SecuritySettingsProto(
                        password_reset_enabled=settings.password_reset_enabled,
                        mfa_required_for_members=settings.mfa_required_for_members,
                        mfa_required_for_admins=settings.mfa_required_for_admins,
                    ),
                )
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.exception(f"Error getting security settings: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_security_settings(
        self,
        request: UpdateSecuritySettingsRequest,
        ctx: RequestContext,
    ) -> UpdateSecuritySettingsResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")
        try:
            async with open_session() as session:
                org_ops = OrganizationOperations(session)
                await org_ops.require_org_admin(user_id, org_id)
                security_ops = SecurityOperations(session)
                settings = await security_ops.get(org_id)
                if request.HasField("password_reset_enabled"):
                    settings = await security_ops.set_password_reset_enabled(
                        organization_id=org_id,
                        enabled=request.password_reset_enabled,
                        actor_user_id=user_id,
                    )
                if request.HasField("mfa_required_for_members"):
                    settings = await security_ops.set_mfa_required_for_members(
                        organization_id=org_id,
                        required=request.mfa_required_for_members,
                        actor_user_id=user_id,
                    )
                if request.HasField("mfa_required_for_admins"):
                    settings = await security_ops.set_mfa_required_for_admins(
                        organization_id=org_id,
                        required=request.mfa_required_for_admins,
                        actor_user_id=user_id,
                    )
                return UpdateSecuritySettingsResponse(
                    settings=SecuritySettingsProto(
                        password_reset_enabled=settings.password_reset_enabled,
                        mfa_required_for_members=settings.mfa_required_for_members,
                        mfa_required_for_admins=settings.mfa_required_for_admins,
                    ),
                )
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.exception(f"Error updating security settings: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")
