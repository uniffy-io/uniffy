"""Agent sessions RPC handlers - thin layer delegating to operations."""

import json
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.agents.v1.sessions_pb2 import (
    AddMessageRequest,
    AddMessageResponse,
    ArchiveSessionRequest,
    ArchiveSessionResponse,
    CompactSessionRequest,
    CompactSessionResponse,
    CreateSessionRequest,
    CreateSessionResponse,
    DeleteMessageRequest,
    DeleteMessageResponse,
    EditMessageRequest,
    EditMessageResponse,
    GetSessionContextRequest,
    GetSessionContextResponse,
    GetSessionContextStatsRequest,
    GetSessionContextStatsResponse,
    GetSessionRequest,
    GetSessionResponse,
    ListMessagesRequest,
    ListMessagesResponse,
    ListSessionsRequest,
    ListSessionsResponse,
    RetryMessageRequest,
    RetryMessageResponse,
    UpdateSessionRequest,
    UpdateSessionResponse,
)
from uniffy_proto.common.v1.common_pb2 import PaginationResponse

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.db import open_session
from uniffy.domains.agents.agents.operations import AgentOperations
from uniffy.domains.agents.providers.operations import ProviderOperations
from uniffy.domains.agents.runtime.model_resolver import resolve_model
from uniffy.domains.agents.runtime.operations import _get_model_context_window
from uniffy.domains.agents.sessions.converters import (
    message_role_from_proto,
    message_to_proto,
    session_kind_from_proto,
    session_to_proto,
)
from uniffy.domains.agents.sessions.operations import SessionOperations
from uniffy.domains.auth.context import get_user_id_from_context


class SessionsHandlers:
    """RPC handlers for sessions service."""

    async def create_session(
        self,
        request: CreateSessionRequest,
        ctx: RequestContext,
    ) -> CreateSessionResponse:
        """Handle create_session RPC call.

        Parameters
        ----------
        request : CreateSessionRequest
            The request with session details.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        SessionResponse
            The created or existing session.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            agent_id = UUID(request.agent_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        kind = session_kind_from_proto(request.kind)

        display_name = request.display_name if request.HasField("display_name") else None
        model_override = request.model_override if request.HasField("model_override") else None

        try:
            async with open_session() as session:
                ops = SessionOperations(session)
                agent_session = await ops.create_session(
                    user_id=user_id,
                    organization_id=org_id,
                    agent_id=agent_id,
                    kind=kind,
                    display_name=display_name,
                    model_override=model_override,
                )
                return CreateSessionResponse(session=session_to_proto(agent_session))

        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error creating session: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_session(
        self,
        request: GetSessionRequest,
        ctx: RequestContext,
    ) -> GetSessionResponse:
        """Handle get_session RPC call.

        Parameters
        ----------
        request : GetSessionRequest
            The request with session ID.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        SessionResponse
            The session.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            session_id = UUID(request.session_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = SessionOperations(session)
                agent_session = await ops.get_session(
                    user_id=user_id,
                    organization_id=org_id,
                    session_id=session_id,
                )
                return GetSessionResponse(session=session_to_proto(agent_session))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Session not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting session: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_sessions(
        self,
        request: ListSessionsRequest,
        ctx: RequestContext,
    ) -> ListSessionsResponse:
        """Handle list_sessions RPC call.

        Parameters
        ----------
        request : ListSessionsRequest
            The request with filters.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        ListSessionsResponse
            Paginated list of sessions.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization ID format")

        # Parse pagination
        page = 1
        page_size = 50
        if request.HasField("pagination"):
            page = request.pagination.page if request.pagination.page > 0 else 1
            page_size = min(
                request.pagination.page_size if request.pagination.page_size > 0 else 50,
                100,
            )

        agent_id = None
        if request.HasField("agent_id"):
            try:
                agent_id = UUID(request.agent_id)
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid agent ID format")

        kind = None
        if request.HasField("kind"):
            kind = session_kind_from_proto(request.kind)

        is_archived = None
        if request.HasField("is_archived"):
            is_archived = request.is_archived

        try:
            async with open_session() as session:
                ops = SessionOperations(session)
                sessions, total = await ops.list_sessions(
                    user_id=user_id,
                    organization_id=org_id,
                    page=page,
                    page_size=page_size,
                    agent_id=agent_id,
                    kind=kind,
                    is_archived=is_archived,
                )
                total_pages = (total + page_size - 1) // page_size if total > 0 else 0
                return ListSessionsResponse(
                    sessions=[session_to_proto(s) for s in sessions],
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
            logger.error(f"Error listing sessions: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_session(
        self,
        request: UpdateSessionRequest,
        ctx: RequestContext,
    ) -> UpdateSessionResponse:
        """Handle update_session RPC call.

        Parameters
        ----------
        request : UpdateSessionRequest
            The request with updated fields.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        SessionResponse
            The updated session.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            session_id = UUID(request.session_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        display_name = request.display_name if request.HasField("display_name") else None
        model_override = request.model_override if request.HasField("model_override") else None

        try:
            async with open_session() as session:
                ops = SessionOperations(session)
                agent_session = await ops.update_session(
                    user_id=user_id,
                    organization_id=org_id,
                    session_id=session_id,
                    display_name=display_name,
                    model_override=model_override,
                )
                return UpdateSessionResponse(session=session_to_proto(agent_session))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Session not found")
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error updating session: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def archive_session(
        self,
        request: ArchiveSessionRequest,
        ctx: RequestContext,
    ) -> ArchiveSessionResponse:
        """Handle archive_session RPC call.

        Parameters
        ----------
        request : ArchiveSessionRequest
            The request with session ID.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        ArchiveSessionResponse
            Success response.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            session_id = UUID(request.session_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = SessionOperations(session)
                await ops.archive_session(
                    user_id=user_id,
                    organization_id=org_id,
                    session_id=session_id,
                )
                return ArchiveSessionResponse(success=True)

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Session not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error archiving session: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def add_message(
        self,
        request: AddMessageRequest,
        ctx: RequestContext,
    ) -> AddMessageResponse:
        """Handle add_message RPC call.

        Parameters
        ----------
        request : AddMessageRequest
            The request with message details.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        MessageResponse
            The created message.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            session_id = UUID(request.session_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        role = message_role_from_proto(request.role)
        content = request.content if request.HasField("content") else None
        model = request.model if request.HasField("model") else None
        tool_name = request.tool_name if request.HasField("tool_name") else None
        tool_call_id = request.tool_call_id if request.HasField("tool_call_id") else None
        tool_result = request.tool_result if request.HasField("tool_result") else None

        tool_args = None
        if request.HasField("tool_args_json") and request.tool_args_json:
            try:
                tool_args = json.loads(request.tool_args_json)
            except json.JSONDecodeError:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid tool_args_json format")

        try:
            async with open_session() as session:
                ops = SessionOperations(session)
                message = await ops.add_message(
                    user_id=user_id,
                    organization_id=org_id,
                    session_id=session_id,
                    role=role,
                    content=content,
                    input_tokens=request.input_tokens,
                    output_tokens=request.output_tokens,
                    model=model,
                    tool_name=tool_name,
                    tool_call_id=tool_call_id,
                    tool_args=tool_args,
                    tool_result=tool_result,
                    is_thinking=request.is_thinking,
                )
                return AddMessageResponse(message=message_to_proto(message))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Session not found")
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error adding message: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_messages(
        self,
        request: ListMessagesRequest,
        ctx: RequestContext,
    ) -> ListMessagesResponse:
        """Handle list_messages RPC call.

        Parameters
        ----------
        request : ListMessagesRequest
            The request with session ID and pagination.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        ListMessagesResponse
            Paginated list of messages.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            session_id = UUID(request.session_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        # Parse pagination
        page = 1
        page_size = 50
        if request.HasField("pagination"):
            page = request.pagination.page if request.pagination.page > 0 else 1
            page_size = min(
                request.pagination.page_size if request.pagination.page_size > 0 else 50,
                200,
            )

        include_compacted = (
            request.include_compacted if request.HasField("include_compacted") else False
        )

        try:
            async with open_session() as session:
                ops = SessionOperations(session)
                messages, total = await ops.list_messages(
                    user_id=user_id,
                    organization_id=org_id,
                    session_id=session_id,
                    page=page,
                    page_size=page_size,
                    include_compacted=include_compacted,
                )
                total_pages = (total + page_size - 1) // page_size if total > 0 else 0
                return ListMessagesResponse(
                    messages=[message_to_proto(m) for m in messages],
                    pagination=PaginationResponse(
                        page=page,
                        page_size=page_size,
                        total_count=total,
                        total_pages=total_pages,
                    ),
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Session not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing messages: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_session_context(
        self,
        request: GetSessionContextRequest,
        ctx: RequestContext,
    ) -> GetSessionContextResponse:
        """Handle get_session_context RPC call.

        Parameters
        ----------
        request : GetSessionContextRequest
            The request with session ID and optional limit.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        GetSessionContextResponse
            Recent messages for LLM context assembly.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            session_id = UUID(request.session_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = SessionOperations(session)
                messages, total = await ops.get_session_context(
                    user_id=user_id,
                    organization_id=org_id,
                    session_id=session_id,
                )
                return GetSessionContextResponse(
                    messages=[message_to_proto(m) for m in messages],
                    total_messages=total,
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Session not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting session context: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_session_context_stats(
        self,
        request: GetSessionContextStatsRequest,
        ctx: RequestContext,
    ) -> GetSessionContextStatsResponse:
        """Handle get_session_context_stats RPC call.

        Parameters
        ----------
        request : GetSessionContextStatsRequest
            The request with session ID.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        GetSessionContextStatsResponse
            Context window statistics.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            session_id = UUID(request.session_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = SessionOperations(session)

                # Resolve model context window from the session's agent config
                agent_session = await ops.get_session(
                    user_id=user_id,
                    organization_id=org_id,
                    session_id=session_id,
                )
                agent_ops = AgentOperations(session)
                agent = await agent_ops.get_by_id(user_id, org_id, agent_session.agent_id)
                provider_ops = ProviderOperations(session)
                target_model = agent_session.model_override or agent.primary_model

                if agent.primary_provider_key_id:
                    provider, _pk = await provider_ops.get_provider_for_key(
                        organization_id=org_id,
                        key_id=agent.primary_provider_key_id,
                    )
                else:
                    provider = await provider_ops.get_provider_for_model(
                        organization_id=org_id,
                        model_id=target_model,
                    )

                model = await resolve_model(
                    session_model_override=agent_session.model_override,
                    agent_primary_model=agent.primary_model,
                    agent_fallback_models=agent.fallback_models or [],
                    provider=provider,
                )
                context_window_tokens = await _get_model_context_window(provider, model)

                stats = await ops.get_context_stats(
                    user_id=user_id,
                    organization_id=org_id,
                    session_id=session_id,
                    context_window_tokens=context_window_tokens,
                )
                return GetSessionContextStatsResponse(
                    total_messages=stats["total_messages"],
                    active_messages=stats["active_messages"],
                    compacted_messages=stats["compacted_messages"],
                    summary_count=stats["summary_count"],
                    active_tokens=stats["active_tokens"],
                    last_input_tokens=stats["last_input_tokens"],
                    last_output_tokens=stats["last_output_tokens"],
                    last_cache_read_tokens=stats["last_cache_read_tokens"],
                    token_budget=stats["token_budget"],
                    tokens_until_compaction=stats["tokens_until_compaction"],
                    context_window_tokens=stats["context_window_tokens"],
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Session not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting session context stats: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def compact_session(
        self,
        request: CompactSessionRequest,
        ctx: RequestContext,
    ) -> CompactSessionResponse:
        """Handle compact_session RPC call.

        Manually triggers compaction for a session. Resolves the
        LLM provider and model from the session's agent config.

        Parameters
        ----------
        request : CompactSessionRequest
            The request with session ID.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        CompactSessionResponse
            Whether compaction was performed and updated stats.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            session_id = UUID(request.session_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = SessionOperations(session)

                # Get session to find agent
                agent_session = await ops.get_session(
                    user_id=user_id,
                    organization_id=org_id,
                    session_id=session_id,
                )

                # Load agent config to resolve provider
                agent_ops = AgentOperations(session)
                agent = await agent_ops.get_by_id(user_id, org_id, agent_session.agent_id)

                # Resolve provider and model
                provider_ops = ProviderOperations(session)
                target_model = agent_session.model_override or agent.primary_model

                if agent.primary_provider_key_id:
                    provider, _pk = await provider_ops.get_provider_for_key(
                        organization_id=org_id,
                        key_id=agent.primary_provider_key_id,
                    )
                else:
                    provider = await provider_ops.get_provider_for_model(
                        organization_id=org_id,
                        model_id=target_model,
                    )

                model = await resolve_model(
                    session_model_override=agent_session.model_override,
                    agent_primary_model=agent.primary_model,
                    agent_fallback_models=agent.fallback_models or [],
                    provider=provider,
                )

                context_window_tokens = await _get_model_context_window(provider, model)

                # Force compaction regardless of token usage
                result = await ops.compact_session_if_needed(
                    user_id=user_id,
                    organization_id=org_id,
                    session_id=session_id,
                    provider=provider,
                    model=model,
                    context_window_tokens=context_window_tokens,
                    force=True,
                )

                # Get updated stats
                stats = await ops.get_context_stats(
                    user_id=user_id,
                    organization_id=org_id,
                    session_id=session_id,
                    context_window_tokens=context_window_tokens,
                )

                return CompactSessionResponse(
                    compacted=result.performed,
                    stats=GetSessionContextStatsResponse(
                        total_messages=stats["total_messages"],
                        active_messages=stats["active_messages"],
                        compacted_messages=stats["compacted_messages"],
                        summary_count=stats["summary_count"],
                        active_tokens=stats["active_tokens"],
                        last_input_tokens=stats["last_input_tokens"],
                        last_output_tokens=stats["last_output_tokens"],
                        token_budget=stats["token_budget"],
                        tokens_until_compaction=stats["tokens_until_compaction"],
                        context_window_tokens=stats["context_window_tokens"],
                    ),
                    messages_compacted=result.messages_compacted,
                    tokens_before=result.tokens_before,
                    tokens_after=result.tokens_after,
                    tokens_saved=result.tokens_saved,
                    summary_tokens=result.summary_tokens,
                )

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Session not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.opt(exception=True).error(
                "Error compacting session: {}",
                str(e),
            )
            raise ConnectError(
                Code.INTERNAL,
                "Compaction failed. The LLM provider rejected the request.",
            )

    async def edit_message(
        self,
        request: EditMessageRequest,
        ctx: RequestContext,
    ) -> EditMessageResponse:
        """Handle edit_message RPC call."""
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            message_id = UUID(request.message_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = SessionOperations(session)
                updated = await ops.edit_message(
                    user_id=user_id,
                    organization_id=org_id,
                    message_id=message_id,
                    new_content=request.new_content,
                )
                return EditMessageResponse(message=message_to_proto(updated))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Message not found")
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error editing message: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_message(
        self,
        request: DeleteMessageRequest,
        ctx: RequestContext,
    ) -> DeleteMessageResponse:
        """Handle delete_message RPC call."""
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            message_id = UUID(request.message_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = SessionOperations(session)
                count = await ops.delete_message(
                    user_id=user_id,
                    organization_id=org_id,
                    message_id=message_id,
                )
                return DeleteMessageResponse(invalidated_count=count)

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Message not found")
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error deleting message: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def retry_message(
        self,
        request: RetryMessageRequest,
        ctx: RequestContext,
    ) -> RetryMessageResponse:
        """Handle retry_message RPC call."""
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            message_id = UUID(request.message_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                ops = SessionOperations(session)
                content, file_ids = await ops.retry_message(
                    user_id=user_id,
                    organization_id=org_id,
                    message_id=message_id,
                )
                return RetryMessageResponse(content=content, file_ids=file_ids)

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Message not found")
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error retrying message: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")
