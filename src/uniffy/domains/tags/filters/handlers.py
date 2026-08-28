"""Saved-filter RPC handlers for the tags explorer, mixed into TagsServiceImpl."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.tags.v1.tags_pb2 import (
    CreateSavedFilterRequest,
    CreateSavedFilterResponse,
    DeleteSavedFilterRequest,
    DeleteSavedFilterResponse,
    ListSavedFiltersRequest,
    ListSavedFiltersResponse,
    UpdateSavedFilterRequest,
    UpdateSavedFilterResponse,
)

from uniffy.core.auth.principal import (
    current_user_id,
    resolve_organization_id,
)
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.db import open_session
from uniffy.domains.tags.filters.converters import (
    criteria_from_proto,
    icon_from_proto,
    saved_filter_to_proto,
)
from uniffy.domains.tags.filters.operations import SavedTagFilterOperations

logger = logger.bind(component="tags.filters.handlers")


def _parse_uuid(value: str, field: str) -> UUID:
    try:
        return UUID(value)
    except ValueError as exc:
        raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid {field}") from exc


class SavedTagFilterHandlersMixin:
    async def create_saved_filter(
        self,
        request: CreateSavedFilterRequest,
        ctx: RequestContext,
    ) -> CreateSavedFilterResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)

        if not request.name or not request.name.strip():
            raise ConnectError(Code.INVALID_ARGUMENT, "Filter name is required")

        try:
            async with open_session() as session:
                ops = SavedTagFilterOperations(session)
                criteria = (
                    criteria_from_proto(request.criteria) if request.HasField("criteria") else {}
                )
                icon = icon_from_proto(request.icon) if request.HasField("icon") else None
                saved = await ops.create(
                    user_id=user_id,
                    organization_id=organization_id,
                    name=request.name,
                    description=request.description if request.HasField("description") else "",
                    icon=icon,
                    criteria=criteria,
                    sort_by=request.sort_by if request.HasField("sort_by") else "count",
                    sort_order=request.sort_order if request.HasField("sort_order") else "desc",
                )
                return CreateSavedFilterResponse(
                    filter=await saved_filter_to_proto(saved, session=session)
                )
        except ConnectError:
            raise
        except Exception as exc:
            logger.exception(f"create_saved_filter failed: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error") from exc

    async def update_saved_filter(
        self,
        request: UpdateSavedFilterRequest,
        ctx: RequestContext,
    ) -> UpdateSavedFilterResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        filter_id = _parse_uuid(request.filter_id, "filter_id")

        try:
            async with open_session() as session:
                ops = SavedTagFilterOperations(session)
                criteria = (
                    criteria_from_proto(request.criteria) if request.HasField("criteria") else None
                )
                icon = icon_from_proto(request.icon) if request.HasField("icon") else None
                saved = await ops.update(
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
                return UpdateSavedFilterResponse(
                    filter=await saved_filter_to_proto(saved, session=session)
                )
        except NotFoundError as exc:
            raise ConnectError(Code.NOT_FOUND, str(exc)) from exc
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc)) from exc
        except ConnectError:
            raise
        except Exception as exc:
            logger.exception(f"update_saved_filter failed: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error") from exc

    async def delete_saved_filter(
        self,
        request: DeleteSavedFilterRequest,
        ctx: RequestContext,
    ) -> DeleteSavedFilterResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        filter_id = _parse_uuid(request.filter_id, "filter_id")

        try:
            async with open_session() as session:
                ops = SavedTagFilterOperations(session)
                await ops.delete(
                    user_id=user_id,
                    organization_id=organization_id,
                    filter_id=filter_id,
                )
            return DeleteSavedFilterResponse(success=True)
        except NotFoundError as exc:
            raise ConnectError(Code.NOT_FOUND, str(exc)) from exc
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc)) from exc
        except ConnectError:
            raise
        except Exception as exc:
            logger.exception(f"delete_saved_filter failed: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error") from exc

    async def list_saved_filters(
        self,
        request: ListSavedFiltersRequest,
        ctx: RequestContext,
    ) -> ListSavedFiltersResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)

        try:
            async with open_session() as session:
                ops = SavedTagFilterOperations(session)
                filters = await ops.list_filters(
                    user_id=user_id,
                    organization_id=organization_id,
                    include_presets=request.include_presets if request.include_presets else True,
                )
                proto_filters = [await saved_filter_to_proto(f, session=session) for f in filters]
            return ListSavedFiltersResponse(filters=proto_filters)
        except ConnectError:
            raise
        except Exception as exc:
            logger.exception(f"list_saved_filters failed: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error") from exc
