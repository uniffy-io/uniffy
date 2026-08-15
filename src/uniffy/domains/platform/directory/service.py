"""ConnectRPC service bindings for ``superadmin.v1`` directory services."""

from connectrpc.request import RequestContext
from uniffy_proto.superadmin.v1.system_directory_pb2 import (
    CreateOrganizationRequest,
    CreateOrganizationResponse,
    CreateUserRequest,
    CreateUserResponse,
    DeleteOrganizationRequest,
    DeleteOrganizationResponse,
    ForceLogoutUserRequest,
    ForceLogoutUserResponse,
    GetOrganizationRequest,
    GetOrganizationResponse,
    GetUserRequest,
    GetUserResponse,
    ListOrganizationsRequest,
    ListOrganizationsResponse,
    ListUsersRequest,
    ListUsersResponse,
    RestoreOrganizationRequest,
    RestoreOrganizationResponse,
    SetSystemAdminRequest,
    SetSystemAdminResponse,
    SuspendOrganizationRequest,
    SuspendOrganizationResponse,
    UnsuspendOrganizationRequest,
    UnsuspendOrganizationResponse,
    UpdateOrganizationRequest,
    UpdateOrganizationResponse,
    UpdateUserRequest,
    UpdateUserResponse,
)

from uniffy.domains.platform.directory.handlers import (
    SystemOrganizationsHandlers,
    SystemUsersHandlers,
)


class SystemOrganizationsServiceImpl:
    def __init__(self) -> None:
        self._handlers = SystemOrganizationsHandlers()

    async def list_organizations(
        self, request: ListOrganizationsRequest, ctx: RequestContext
    ) -> ListOrganizationsResponse:
        return await self._handlers.list_organizations(request, ctx)

    async def get_organization(
        self, request: GetOrganizationRequest, ctx: RequestContext
    ) -> GetOrganizationResponse:
        return await self._handlers.get_organization(request, ctx)

    async def create_organization(
        self, request: CreateOrganizationRequest, ctx: RequestContext
    ) -> CreateOrganizationResponse:
        return await self._handlers.create_organization(request, ctx)

    async def update_organization(
        self, request: UpdateOrganizationRequest, ctx: RequestContext
    ) -> UpdateOrganizationResponse:
        return await self._handlers.update_organization(request, ctx)

    async def suspend_organization(
        self, request: SuspendOrganizationRequest, ctx: RequestContext
    ) -> SuspendOrganizationResponse:
        return await self._handlers.suspend_organization(request, ctx)

    async def unsuspend_organization(
        self, request: UnsuspendOrganizationRequest, ctx: RequestContext
    ) -> UnsuspendOrganizationResponse:
        return await self._handlers.unsuspend_organization(request, ctx)

    async def delete_organization(
        self, request: DeleteOrganizationRequest, ctx: RequestContext
    ) -> DeleteOrganizationResponse:
        return await self._handlers.delete_organization(request, ctx)

    async def restore_organization(
        self, request: RestoreOrganizationRequest, ctx: RequestContext
    ) -> RestoreOrganizationResponse:
        return await self._handlers.restore_organization(request, ctx)


class SystemUsersServiceImpl:
    def __init__(self) -> None:
        self._handlers = SystemUsersHandlers()

    async def list_users(self, request: ListUsersRequest, ctx: RequestContext) -> ListUsersResponse:
        return await self._handlers.list_users(request, ctx)

    async def get_user(self, request: GetUserRequest, ctx: RequestContext) -> GetUserResponse:
        return await self._handlers.get_user(request, ctx)

    async def create_user(
        self, request: CreateUserRequest, ctx: RequestContext
    ) -> CreateUserResponse:
        return await self._handlers.create_user(request, ctx)

    async def update_user(
        self, request: UpdateUserRequest, ctx: RequestContext
    ) -> UpdateUserResponse:
        return await self._handlers.update_user(request, ctx)

    async def force_logout_user(
        self, request: ForceLogoutUserRequest, ctx: RequestContext
    ) -> ForceLogoutUserResponse:
        return await self._handlers.force_logout_user(request, ctx)

    async def set_system_admin(
        self, request: SetSystemAdminRequest, ctx: RequestContext
    ) -> SetSystemAdminResponse:
        return await self._handlers.set_system_admin(request, ctx)
