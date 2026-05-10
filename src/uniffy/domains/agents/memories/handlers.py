"""Agent memories RPC handlers - thin layer delegating to operations."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.agents.v1.memories_pb2 import (
    MEMORY_CATEGORY_UNSPECIFIED,
    CreateMemoryRequest,
    CreateMemoryResponse,
    DeleteMemoryRequest,
    DeleteMemoryResponse,
    ListMemoriesRequest,
    ListMemoriesResponse,
    UpdateMemoryRequest,
    UpdateMemoryResponse,
)
from uniffy_proto.common.v1.common_pb2 import PaginationResponse

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.db import open_session
from uniffy.domains.agents.memories.converters import memory_category_from_proto, memory_to_proto
from uniffy.domains.agents.memories.operations import MemoryOperations
from uniffy.domains.auth.context import get_user_id_from_context


class MemoriesHandlers:
    """RPC handlers for memories service."""

    async def create_memory(
        self,
        request: CreateMemoryRequest,
        ctx: RequestContext,
    ) -> CreateMemoryResponse:
        """Handle create_memory RPC call.

        Parameters
        ----------
        request : CreateMemoryRequest
            The request with memory details.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        MemoryResponse
            The created memory.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            agent_id = UUID(request.agent_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        category: str = "facts"
        if request.category != MEMORY_CATEGORY_UNSPECIFIED:
            resolved = memory_category_from_proto(request.category)
            if resolved:
                category = resolved

        importance: float = 0.5
        if request.HasField("importance"):
            importance = request.importance

        try:
            async with open_session() as session:
                ops = MemoryOperations(session)
                memory = await ops.create_memory(
                    user_id=user_id,
                    organization_id=org_id,
                    agent_id=agent_id,
                    key=request.key,
                    content=request.content,
                    category=category,
                    importance=importance,
                )
                return CreateMemoryResponse(memory=memory_to_proto(memory))

        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error creating memory: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_memories(
        self,
        request: ListMemoriesRequest,
        ctx: RequestContext,
    ) -> ListMemoriesResponse:
        """Handle list_memories RPC call.

        Parameters
        ----------
        request : ListMemoriesRequest
            The request with agent ID, optional category/search/pagination.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        ListMemoriesResponse
            Paginated list of memories.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            agent_id = UUID(request.agent_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        # Convert optional category from proto enum to string
        category: str | None = None
        if request.category != MEMORY_CATEGORY_UNSPECIFIED:
            category = memory_category_from_proto(request.category)

        # Optional search term
        search: str | None = request.search if request.search else None

        page = 1
        page_size = 50
        if request.HasField("pagination"):
            page = request.pagination.page if request.pagination.page > 0 else 1
            page_size = min(
                request.pagination.page_size if request.pagination.page_size > 0 else 50,
                100,
            )

        try:
            async with open_session() as session:
                ops = MemoryOperations(session)
                memories, total = await ops.list_memories(
                    user_id=user_id,
                    organization_id=org_id,
                    agent_id=agent_id,
                    category=category,
                    search=search,
                    page=page,
                    page_size=page_size,
                )
                total_pages = (total + page_size - 1) // page_size if total > 0 else 0
                return ListMemoriesResponse(
                    memories=[memory_to_proto(m) for m in memories],
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
            logger.error(f"Error listing memories: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_memory(
        self,
        request: UpdateMemoryRequest,
        ctx: RequestContext,
    ) -> UpdateMemoryResponse:
        """Handle update_memory RPC call.

        Parameters
        ----------
        request : UpdateMemoryRequest
            The request with updated fields.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        MemoryResponse
            The updated memory.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            memory_id = UUID(request.memory_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        content: str | None = request.content if request.HasField("content") else None
        importance: float | None = request.importance if request.HasField("importance") else None

        # Convert optional category from proto enum to string
        category: str | None = None
        if request.HasField("category") and request.category != MEMORY_CATEGORY_UNSPECIFIED:
            category = memory_category_from_proto(request.category)

        try:
            async with open_session() as session:
                ops = MemoryOperations(session)
                memory = await ops.update_memory(
                    user_id=user_id,
                    organization_id=org_id,
                    memory_id=memory_id,
                    content=content,
                    category=category,
                    importance=importance,
                )
                return UpdateMemoryResponse(memory=memory_to_proto(memory))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Memory not found")
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error updating memory: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_memory(
        self,
        request: DeleteMemoryRequest,
        ctx: RequestContext,
    ) -> DeleteMemoryResponse:
        """Handle delete_memory RPC call.

        Parameters
        ----------
        request : DeleteMemoryRequest
            The request with memory ID.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        DeleteMemoryResponse
            Success response.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            memory_id = UUID(request.memory_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = MemoryOperations(session)
                await ops.delete_memory(
                    user_id=user_id,
                    organization_id=org_id,
                    memory_id=memory_id,
                )
                return DeleteMemoryResponse(success=True)

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Memory not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error deleting memory: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")
