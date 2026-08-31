"""Calendar category RPC handlers."""

from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from uniffy_proto.cal.v1.calendar_pb2 import (
    CreateCategoryRequest,
    CreateCategoryResponse,
    DeleteCategoryRequest,
    DeleteCategoryResponse,
    GetCategoryRequest,
    GetCategoryResponse,
    ListCategoriesRequest,
    ListCategoriesResponse,
    UpdateCategoryRequest,
    UpdateCategoryResponse,
)

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.domains.scheduling.calendar.categories.operations import CategoryOperations
from uniffy.domains.scheduling.calendar.converters import category_to_proto
from uniffy.domains.scheduling.calendar.rpc.support import map_domain_error, parse_uuid
from uniffy.infrastructure.database import open_session


class CategoryHandlers:
    async def create_category(
        self,
        request: CreateCategoryRequest,
        ctx: RequestContext,
    ) -> CreateCategoryResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)

        try:
            async with open_session() as session:
                category = await CategoryOperations(session).create(
                    user_id=user_id,
                    organization_id=organization_id,
                    name=request.name,
                    color=request.color,
                    icon=request.icon if request.HasField("icon") else None,
                )
                return CreateCategoryResponse(category=category_to_proto(category))
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("create_category", exc) from exc

    async def get_category(
        self,
        request: GetCategoryRequest,
        ctx: RequestContext,
    ) -> GetCategoryResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        category_id = parse_uuid(request.category_id, "category_id")

        try:
            async with open_session() as session:
                category = await CategoryOperations(session).get_by_id(
                    user_id, category_id, organization_id
                )
                return GetCategoryResponse(category=category_to_proto(category))
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("get_category", exc) from exc

    async def update_category(
        self,
        request: UpdateCategoryRequest,
        ctx: RequestContext,
    ) -> UpdateCategoryResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        category_id = parse_uuid(request.category_id, "category_id")

        try:
            async with open_session() as session:
                category = await CategoryOperations(session).update(
                    user_id=user_id,
                    category_id=category_id,
                    organization_id=organization_id,
                    name=request.name if request.HasField("name") else None,
                    color=request.color if request.HasField("color") else None,
                    icon=request.icon if request.HasField("icon") else None,
                    sort_order=request.sort_order if request.HasField("sort_order") else None,
                )
                return UpdateCategoryResponse(category=category_to_proto(category))
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("update_category", exc) from exc

    async def delete_category(
        self,
        request: DeleteCategoryRequest,
        ctx: RequestContext,
    ) -> DeleteCategoryResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)
        category_id = parse_uuid(request.category_id, "category_id")

        try:
            async with open_session() as session:
                await CategoryOperations(session).delete(user_id, category_id, organization_id)
                return DeleteCategoryResponse(success=True, message="Category deleted")
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("delete_category", exc) from exc

    async def list_categories(
        self,
        request: ListCategoriesRequest,
        ctx: RequestContext,
    ) -> ListCategoriesResponse:
        user_id = current_user_id()
        organization_id = resolve_organization_id(request.organization_id)

        try:
            async with open_session() as session:
                operations = CategoryOperations(session)
                await operations.ensure_defaults(user_id, organization_id)
                categories = await operations.list_categories(user_id, organization_id)
                return ListCategoriesResponse(
                    categories=[category_to_proto(category) for category in categories]
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("list_categories", exc) from exc
