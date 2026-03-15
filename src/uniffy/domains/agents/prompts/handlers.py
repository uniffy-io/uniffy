"""Agent prompts RPC handlers - thin layer delegating to operations."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger

from uniffy.core.converters.common_proto import visibility_from_proto
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.types import VisibilityScope
from uniffy.db import get_async_session
from uniffy.domains.agents.prompts.converters import prompt_to_proto
from uniffy.domains.agents.prompts.operations import PromptOperations
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.gen.agents.v1.prompts_pb2 import (
    CreatePromptRequest,
    DeletePromptRequest,
    DeletePromptResponse,
    GetPromptRequest,
    ListPromptsRequest,
    ListPromptsResponse,
    PromptResponse,
    UpdatePromptRequest,
)
from uniffy.gen.common.v1.common_pb2 import PaginationResponse


class PromptsHandlers:
    """RPC handlers for prompts service."""

    async def create_prompt(
        self,
        request: CreatePromptRequest,
        ctx: RequestContext,
    ) -> PromptResponse:
        """Handle create_prompt RPC call.

        Parameters
        ----------
        request : CreatePromptRequest
            The request with prompt details.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        PromptResponse
            The created prompt.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization ID format")

        owner_id: UUID | None = None
        if request.HasField("owner_id") and request.owner_id:
            try:
                owner_id = UUID(request.owner_id)
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid owner ID format")

        visibility = VisibilityScope.PRIVATE
        if request.HasField("visibility"):
            resolved = visibility_from_proto(request.visibility)
            if resolved is not None:
                visibility = resolved

        name = request.name if request.HasField("name") and request.name else None

        try:
            async for session in get_async_session():
                ops = PromptOperations(session)
                prompt = await ops.create_prompt(
                    user_id=user_id,
                    organization_id=org_id,
                    display_name=request.display_name,
                    name=name,
                    description=request.description,
                    content=request.content,
                    owner_id=owner_id,
                    visibility=visibility,
                )
                return PromptResponse(prompt=prompt_to_proto(prompt))

        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error creating prompt: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_prompt(
        self,
        request: GetPromptRequest,
        ctx: RequestContext,
    ) -> PromptResponse:
        """Handle get_prompt RPC call.

        Parameters
        ----------
        request : GetPromptRequest
            The request with prompt ID.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        PromptResponse
            The prompt.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            prompt_id = UUID(request.prompt_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                ops = PromptOperations(session)
                prompt = await ops.get_prompt(
                    user_id=user_id,
                    organization_id=org_id,
                    prompt_id=prompt_id,
                )
                return PromptResponse(prompt=prompt_to_proto(prompt))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Prompt not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting prompt: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_prompts(
        self,
        request: ListPromptsRequest,
        ctx: RequestContext,
    ) -> ListPromptsResponse:
        """Handle list_prompts RPC call.

        Parameters
        ----------
        request : ListPromptsRequest
            The request with organization ID and pagination.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        ListPromptsResponse
            Paginated list of prompts.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization ID format")

        page = 1
        page_size = 50
        if request.HasField("pagination"):
            page = request.pagination.page if request.pagination.page > 0 else 1
            page_size = min(
                request.pagination.page_size if request.pagination.page_size > 0 else 50,
                100,
            )

        try:
            async for session in get_async_session():
                ops = PromptOperations(session)
                prompts, total = await ops.list_prompts(
                    user_id=user_id,
                    organization_id=org_id,
                    page=page,
                    page_size=page_size,
                )
                total_pages = (total + page_size - 1) // page_size if total > 0 else 0
                return ListPromptsResponse(
                    prompts=[prompt_to_proto(p) for p in prompts],
                    pagination=PaginationResponse(
                        page=page,
                        page_size=page_size,
                        total_count=total,
                        total_pages=total_pages,
                    ),
                )

        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing prompts: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_prompt(
        self,
        request: UpdatePromptRequest,
        ctx: RequestContext,
    ) -> PromptResponse:
        """Handle update_prompt RPC call.

        Parameters
        ----------
        request : UpdatePromptRequest
            The request with updated fields.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        PromptResponse
            The updated prompt.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            prompt_id = UUID(request.prompt_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        name = request.name if request.HasField("name") else None
        display_name = request.display_name if request.HasField("display_name") else None
        description = request.description if request.HasField("description") else None
        content = request.content if request.HasField("content") else None

        visibility: VisibilityScope | None = None
        if request.HasField("visibility"):
            visibility = visibility_from_proto(request.visibility)

        try:
            async for session in get_async_session():
                ops = PromptOperations(session)
                prompt = await ops.update_prompt(
                    user_id=user_id,
                    organization_id=org_id,
                    prompt_id=prompt_id,
                    name=name,
                    display_name=display_name,
                    description=description,
                    content=content,
                    visibility=visibility,
                )
                return PromptResponse(prompt=prompt_to_proto(prompt))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Prompt not found")
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error updating prompt: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_prompt(
        self,
        request: DeletePromptRequest,
        ctx: RequestContext,
    ) -> DeletePromptResponse:
        """Handle delete_prompt RPC call.

        Parameters
        ----------
        request : DeletePromptRequest
            The request with prompt ID.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        DeletePromptResponse
            Success response.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            prompt_id = UUID(request.prompt_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                ops = PromptOperations(session)
                await ops.delete_prompt(
                    user_id=user_id,
                    organization_id=org_id,
                    prompt_id=prompt_id,
                )
                return DeletePromptResponse(success=True)

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Prompt not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error deleting prompt: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")
