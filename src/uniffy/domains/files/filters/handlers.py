"""Saved file filter RPC handlers."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.files.v1.files_pb2 import (
    CreateSavedFilterRequest,
    CreateSavedFilterResponse,
    DeleteSavedFilterRequest,
    DeleteSavedFilterResponse,
    GetSavedFilterRequest,
    GetSavedFilterResponse,
    ListSavedFiltersRequest,
    ListSavedFiltersResponse,
    UpdateSavedFilterRequest,
    UpdateSavedFilterResponse,
)

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.db import open_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.files.filters.converters import (
    criteria_from_proto,
    icon_from_proto,
    saved_filter_to_proto,
)
from uniffy.domains.files.filters.operations import SavedFilterOperations


class SavedFilterHandlersMixin:
    async def create_saved_filter(
        self,
        request: CreateSavedFilterRequest,
        ctx: RequestContext,
    ) -> CreateSavedFilterResponse:
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = get_user_id_from_context(ctx)

        if not request.name or not request.name.strip():
            raise ConnectError(Code.INVALID_ARGUMENT, "Filter name is required")

        try:
            async with open_session() as session:
                ops = SavedFilterOperations(session)

                criteria = {}
                if request.HasField("criteria"):
                    criteria = criteria_from_proto(request.criteria)

                icon = None
                if request.HasField("icon"):
                    icon = icon_from_proto(request.icon)

                saved_filter = await ops.create(
                    user_id=user_id,
                    organization_id=organization_id,
                    name=request.name.strip(),
                    criteria=criteria,
                    description=request.description if request.HasField("description") else None,
                    icon=icon,
                    sort_by=request.sort_by if request.HasField("sort_by") else None,
                    sort_order=request.sort_order if request.HasField("sort_order") else None,
                )

                return CreateSavedFilterResponse(filter=saved_filter_to_proto(saved_filter))

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error creating saved filter: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def get_saved_filter(
        self,
        request: GetSavedFilterRequest,
        ctx: RequestContext,
    ) -> GetSavedFilterResponse:
        try:
            filter_id = UUID(request.filter_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async with open_session() as session:
                ops = SavedFilterOperations(session)
                saved_filter = await ops.get_by_id(user_id, organization_id, filter_id)
                return GetSavedFilterResponse(filter=saved_filter_to_proto(saved_filter))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Saved filter not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting saved filter: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def update_saved_filter(
        self,
        request: UpdateSavedFilterRequest,
        ctx: RequestContext,
    ) -> UpdateSavedFilterResponse:
        try:
            filter_id = UUID(request.filter_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async with open_session() as session:
                ops = SavedFilterOperations(session)

                criteria = None
                if request.HasField("criteria"):
                    criteria = criteria_from_proto(request.criteria)

                icon = None
                if request.HasField("icon"):
                    icon = icon_from_proto(request.icon)

                saved_filter = await ops.update(
                    user_id=user_id,
                    organization_id=organization_id,
                    filter_id=filter_id,
                    name=request.name if request.HasField("name") else None,
                    description=request.description if request.HasField("description") else None,
                    icon=icon,
                    criteria=criteria,
                    sort_by=request.sort_by if request.HasField("sort_by") else None,
                    sort_order=request.sort_order if request.HasField("sort_order") else None,
                )

                return UpdateSavedFilterResponse(filter=saved_filter_to_proto(saved_filter))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Saved filter not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error updating saved filter: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def delete_saved_filter(
        self,
        request: DeleteSavedFilterRequest,
        ctx: RequestContext,
    ) -> DeleteSavedFilterResponse:
        try:
            filter_id = UUID(request.filter_id)
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        user_id = get_user_id_from_context(ctx)

        try:
            async with open_session() as session:
                ops = SavedFilterOperations(session)
                await ops.delete(user_id, organization_id, filter_id)
                return DeleteSavedFilterResponse(
                    success=True,
                    message="Filter deleted successfully",
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Saved filter not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error deleting saved filter: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")

    async def list_saved_filters(
        self,
        request: ListSavedFiltersRequest,
        ctx: RequestContext,
    ) -> ListSavedFiltersResponse:
        try:
            organization_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        user_id = get_user_id_from_context(ctx)

        try:
            async with open_session() as session:
                ops = SavedFilterOperations(session)
                filters = await ops.list_filters(
                    user_id=user_id,
                    organization_id=organization_id,
                    include_presets=request.include_presets,
                )

                return ListSavedFiltersResponse(
                    filters=[saved_filter_to_proto(f) for f in filters],
                )

        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing saved filters: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, f"Internal server error: {e}")
