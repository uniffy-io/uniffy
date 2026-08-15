"""Agent memories RPC handlers - thin layer delegating to operations."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.agents.v1.memories_pb2 import (
    MEMORY_CATEGORY_UNSPECIFIED,
    CreateMemoryRequest,
    CreateMemoryResponse,
    DeleteMemoryRequest,
    DeleteMemoryResponse,
    GetMemorySharingRequest,
    GetMemorySharingResponse,
    ListMemoriesRequest,
    ListMemoriesResponse,
    SetMemoryPinnedRequest,
    SetMemoryPinnedResponse,
    SetMemorySharingRequest,
    SetMemorySharingResponse,
    UpdateMemoryRequest,
    UpdateMemoryResponse,
)
from uniffy_proto.common.v1.common_pb2 import PaginationResponse

from uniffy.core.auth.membership import is_active_member
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.memory import MemoryScope
from uniffy.core.models.login.user import User
from uniffy.db import open_session
from uniffy.domains.agents.memories.bridge import (
    is_personal_bridge_enabled,
    set_personal_bridge,
)
from uniffy.domains.agents.memories.converters import (
    memory_category_from_proto,
    memory_scope_from_proto,
    memory_to_proto,
)
from uniffy.domains.agents.memories.operations import MemoryOperations
from uniffy.domains.agents.memories.scope import MemoryScopeRef
from uniffy.domains.agents.runtime.settings import get_runtime_settings
from uniffy.domains.auth.context import get_user_id_from_context

logger = logger.bind(component="agents.memories.handlers")


def _parse_scope_ref(
    scope_value: int,
    *,
    channel_id: str | None,
    session_id: str | None,
    agent_id: str | None,
    user_id: UUID,
) -> MemoryScopeRef:
    """Only organization memory takes an agent; every other bucket is shared."""
    scope = memory_scope_from_proto(scope_value)
    try:
        if scope is not MemoryScope.ORG and agent_id:
            raise ValidationError("agent_id", "Only organization memory can be scoped to one agent")
        if scope is MemoryScope.USER:
            return MemoryScopeRef.user(user_id)
        if scope is MemoryScope.CHANNEL:
            if not channel_id:
                raise ValidationError("channel_id", "channel_id is required for channel scope")
            return MemoryScopeRef.channel(UUID(channel_id))
        if scope is MemoryScope.SESSION:
            if not session_id:
                raise ValidationError("session_id", "session_id is required for session scope")
            return MemoryScopeRef.session(UUID(session_id))
        return MemoryScopeRef.org(UUID(agent_id) if agent_id else None)
    except ValueError:
        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")


async def _resolve_names(session: AsyncSession, user_ids: set[UUID]) -> dict[UUID, str]:
    if not user_ids:
        return {}
    rows = (
        await session.execute(
            select(User.id, User.full_name, User.username).where(
                User.id.in_(user_ids)  # type: ignore[attr-defined]
            )
        )
    ).all()
    return {uid: (full_name or username or "") for uid, full_name, username in rows}


async def _resolve_agent_names(session: AsyncSession, agent_ids: set[UUID]) -> dict[UUID, str]:
    """Provenance labels: which agent wrote an entry the whole audience shares."""
    if not agent_ids:
        return {}
    rows = (
        await session.execute(
            select(Agent.id, Agent.name).where(Agent.id.in_(agent_ids))  # type: ignore[attr-defined]
        )
    ).all()
    return dict(rows)


async def _to_proto_list(session: AsyncSession, memories: list) -> list:
    names = await _resolve_names(session, {m.created_by_user_id for m in memories})
    agent_names = await _resolve_agent_names(
        session, {m.created_by_agent_id for m in memories if m.created_by_agent_id}
    )
    return [
        memory_to_proto(
            m,
            created_by_name=names.get(m.created_by_user_id, ""),
            created_by_agent_name=agent_names.get(m.created_by_agent_id, "")
            if m.created_by_agent_id
            else "",
        )
        for m in memories
    ]


def _map_error(exc: Exception) -> ConnectError:
    if isinstance(exc, NotFoundError):
        return ConnectError(Code.NOT_FOUND, "Memory not found")
    if isinstance(exc, ValidationError):
        return ConnectError(Code.INVALID_ARGUMENT, str(exc))
    if isinstance(exc, PermissionDeniedError):
        return ConnectError(Code.PERMISSION_DENIED, str(exc))
    logger.exception(f"Memories RPC error: {exc}")
    return ConnectError(Code.INTERNAL, "Internal server error")


class MemoriesHandlers:
    """RPC handlers for memories service."""

    async def create_memory(
        self,
        request: CreateMemoryRequest,
        ctx: RequestContext,
    ) -> CreateMemoryResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        ref = _parse_scope_ref(
            request.scope,
            channel_id=request.channel_id if request.HasField("channel_id") else None,
            session_id=request.session_id if request.HasField("session_id") else None,
            agent_id=request.agent_id if request.HasField("agent_id") else None,
            user_id=user_id,
        )

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
                    ref=ref,
                    key=request.key,
                    description=request.description,
                    content=request.content,
                    category=category,
                    importance=importance,
                )
                infos = await _to_proto_list(session, [memory])
                return CreateMemoryResponse(memory=infos[0])
        except ConnectError:
            raise
        except Exception as e:
            raise _map_error(e)

    async def list_memories(
        self,
        request: ListMemoriesRequest,
        ctx: RequestContext,
    ) -> ListMemoriesResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        ref = _parse_scope_ref(
            request.scope,
            channel_id=request.channel_id if request.HasField("channel_id") else None,
            session_id=request.session_id if request.HasField("session_id") else None,
            agent_id=request.agent_id if request.HasField("agent_id") else None,
            user_id=user_id,
        )

        category: str | None = None
        if request.category != MEMORY_CATEGORY_UNSPECIFIED:
            category = memory_category_from_proto(request.category)

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
                    ref=ref,
                    category=category,
                    search=search,
                    page=page,
                    page_size=page_size,
                )
                total_pages = (total + page_size - 1) // page_size if total > 0 else 0
                return ListMemoriesResponse(
                    memories=await _to_proto_list(session, memories),
                    pagination=PaginationResponse(
                        page=page,
                        page_size=page_size,
                        total_count=total,
                        total_pages=total_pages,
                    ),
                )
        except ConnectError:
            raise
        except Exception as e:
            raise _map_error(e)

    async def update_memory(
        self,
        request: UpdateMemoryRequest,
        ctx: RequestContext,
    ) -> UpdateMemoryResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            memory_id = UUID(request.memory_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        content: str | None = request.content if request.HasField("content") else None
        importance: float | None = request.importance if request.HasField("importance") else None
        description: str | None = request.description if request.HasField("description") else None

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
                    description=description,
                    content=content,
                    category=category,
                    importance=importance,
                )
                infos = await _to_proto_list(session, [memory])
                return UpdateMemoryResponse(memory=infos[0])
        except ConnectError:
            raise
        except Exception as e:
            raise _map_error(e)

    async def delete_memory(
        self,
        request: DeleteMemoryRequest,
        ctx: RequestContext,
    ) -> DeleteMemoryResponse:
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
        except ConnectError:
            raise
        except Exception as e:
            raise _map_error(e)

    async def get_memory_sharing(
        self,
        request: GetMemorySharingRequest,
        ctx: RequestContext,
    ) -> GetMemorySharingResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                if not await is_active_member(user_id, org_id, session=session):
                    raise ConnectError(Code.PERMISSION_DENIED, "Not an organization member")
                settings = await get_runtime_settings(session, org_id)
                enabled = await is_personal_bridge_enabled(
                    session, user_id=user_id, organization_id=org_id
                )
                return GetMemorySharingResponse(
                    use_in_shared_spaces=enabled,
                    org_allows=settings.personal_memory_bridge_enabled,
                )
        except ConnectError:
            raise
        except Exception as e:
            raise _map_error(e)

    async def set_memory_sharing(
        self,
        request: SetMemorySharingRequest,
        ctx: RequestContext,
    ) -> SetMemorySharingResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                if not await is_active_member(user_id, org_id, session=session):
                    raise ConnectError(Code.PERMISSION_DENIED, "Not an organization member")
                settings = await get_runtime_settings(session, org_id)
                if request.use_in_shared_spaces and not settings.personal_memory_bridge_enabled:
                    raise ConnectError(
                        Code.FAILED_PRECONDITION,
                        "Personal memory in shared spaces is disabled by your organization",
                    )
                await set_personal_bridge(
                    session,
                    user_id=user_id,
                    organization_id=org_id,
                    enabled=request.use_in_shared_spaces,
                )
                return SetMemorySharingResponse(
                    use_in_shared_spaces=request.use_in_shared_spaces,
                    org_allows=settings.personal_memory_bridge_enabled,
                )
        except ConnectError:
            raise
        except Exception as e:
            raise _map_error(e)

    async def set_memory_pinned(
        self,
        request: SetMemoryPinnedRequest,
        ctx: RequestContext,
    ) -> SetMemoryPinnedResponse:
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            memory_id = UUID(request.memory_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = MemoryOperations(session)
                memory = await ops.set_memory_pinned(
                    user_id=user_id,
                    organization_id=org_id,
                    memory_id=memory_id,
                    pinned=request.pinned,
                )
                infos = await _to_proto_list(session, [memory])
                return SetMemoryPinnedResponse(memory=infos[0])
        except ConnectError:
            raise
        except Exception as e:
            raise _map_error(e)
