"""Chat category RPC handlers."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.chat.v1.chat_pb2 import (
    CreateCategoryRequest,
    CreateCategoryResponse,
    DeleteCategoryRequest,
    DeleteCategoryResponse,
    ListCategoriesRequest,
    ListCategoriesResponse,
    MoveChannelToCategoryRequest,
    MoveChannelToCategoryResponse,
    ReorderCategoriesRequest,
    ReorderCategoriesResponse,
    UpdateCategoryRequest,
    UpdateCategoryResponse,
)

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.db import open_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.chat.categories.operations import ChatCategoryOperations
from uniffy.domains.chat.channels.converters import category_to_proto, channel_to_proto

logger = logger.bind(component="chat.categories.handlers")


def _handle_error(e: Exception) -> None:
    if isinstance(e, NotFoundError):
        raise ConnectError(Code.NOT_FOUND, str(e))
    if isinstance(e, PermissionDeniedError):
        raise ConnectError(Code.PERMISSION_DENIED, str(e))
    if isinstance(e, ValidationError):
        raise ConnectError(Code.INVALID_ARGUMENT, str(e))
    logger.exception(f"Unexpected error: {e}")
    raise ConnectError(Code.INTERNAL, "Internal error")


class CategoryHandlers:
    async def create_category(
        self,
        request: CreateCategoryRequest,
        ctx: RequestContext,
    ) -> CreateCategoryResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        try:
            async with open_session() as session:
                ops = ChatCategoryOperations(session)
                cat = await ops.create(user_id, org_id, request.name)
                return CreateCategoryResponse(category=category_to_proto(cat))
        except (PermissionDeniedError, ValidationError) as e:
            _handle_error(e)

    async def update_category(
        self,
        request: UpdateCategoryRequest,
        ctx: RequestContext,
    ) -> UpdateCategoryResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            cat_id = UUID(request.category_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        name = request.name if request.HasField("name") else None

        try:
            async with open_session() as session:
                ops = ChatCategoryOperations(session)
                cat = await ops.update(user_id, org_id, cat_id, name=name)
                return UpdateCategoryResponse(category=category_to_proto(cat))
        except (NotFoundError, PermissionDeniedError) as e:
            _handle_error(e)

    async def delete_category(
        self,
        request: DeleteCategoryRequest,
        ctx: RequestContext,
    ) -> DeleteCategoryResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            cat_id = UUID(request.category_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = ChatCategoryOperations(session)
                await ops.delete(user_id, org_id, cat_id)
                return DeleteCategoryResponse()
        except (NotFoundError, PermissionDeniedError) as e:
            _handle_error(e)

    async def list_categories(
        self,
        request: ListCategoriesRequest,
        ctx: RequestContext,
    ) -> ListCategoriesResponse:
        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        async with open_session() as session:
            ops = ChatCategoryOperations(session)
            cats = await ops.list_categories(org_id)
            return ListCategoriesResponse(categories=[category_to_proto(c) for c in cats])

    async def reorder_categories(
        self,
        request: ReorderCategoriesRequest,
        ctx: RequestContext,
    ) -> ReorderCategoriesResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            cat_ids = [UUID(c) for c in request.category_ids]
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = ChatCategoryOperations(session)
                cats = await ops.reorder(user_id, org_id, cat_ids)
                return ReorderCategoriesResponse(categories=[category_to_proto(c) for c in cats])
        except PermissionDeniedError as e:
            _handle_error(e)

    async def move_channel_to_category(
        self,
        request: MoveChannelToCategoryRequest,
        ctx: RequestContext,
    ) -> MoveChannelToCategoryResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
            cat_id = None
            if request.HasField("category_id") and request.category_id:
                cat_id = UUID(request.category_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = ChatCategoryOperations(session)
                await ops.move_channel_to_category(user_id, org_id, channel_id, cat_id)

                from uniffy.domains.chat.channels.operations import ChatChannelOperations

                ch_ops = ChatChannelOperations(session)
                channel = await ch_ops.get_by_id(user_id, org_id, channel_id)
                from uniffy.domains.chat.channels.handlers import _hydrate_channel_tags

                tags_by_id = await _hydrate_channel_tags(session, org_id, [channel.id])
                return MoveChannelToCategoryResponse(
                    channel=channel_to_proto(channel, tags=tags_by_id.get(channel.id))
                )
        except (NotFoundError, PermissionDeniedError) as e:
            _handle_error(e)
