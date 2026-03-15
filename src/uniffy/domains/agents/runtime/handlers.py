"""Agent runtime RPC handlers - thin layer delegating to operations."""

import asyncio
from collections.abc import AsyncIterator
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import (
    NotFoundError,
    PermissionDeniedError,
    RateLimitExceededError,
    ValidationError,
)
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.core.models.login.user import User
from uniffy.db import get_async_session
from uniffy.domains.agents.runtime.approvals import get_approval_store
from uniffy.domains.agents.runtime.converters import (
    runtime_stream_event_to_proto,
    send_message_response_to_proto,
    usage_stats_to_proto,
)
from uniffy.domains.agents.runtime.operations import FileContext, RuntimeOperations
from uniffy.domains.agents.runtime.usage import UsageOperations
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.gen.agents.v1.runtime_pb2 import (
    ConfirmationResponse,
    ConfirmationResponseAck,
    GetUsageStatsRequest,
    GetUsageStatsResponse,
    SendMessageRequest,
    SendMessageResponse,
    StreamSendMessageEvent,
)


async def _load_files(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    file_ids: list[str],
) -> list[FileContext]:
    """Load files from database by ID for LLM processing.

    Runs full permission check via FileOperations.get_by_id().

    Parameters
    ----------
    session : AsyncSession
        Database session.
    user_id : UUID
        The user requesting the files.
    organization_id : UUID
        Organization scope.
    file_ids : list[str]
        File IDs to load.

    Returns
    -------
    list[FileContext]
        Loaded file contexts ready for LLM processing.

    """
    from uniffy.domains.files.operations import FileOperations

    ops = FileOperations(session)
    files: list[FileContext] = []
    for fid in file_ids:
        file = await ops.get_by_id(user_id, organization_id, UUID(fid))
        files.append(
            FileContext(
                file_id=str(file.id),
                media_type=file.mime_type or "",
                filename=file.filename,
                storage_key=file.storage_key,
                extracted_text=(
                    file.media_info.extracted_text
                    if file.media_info and file.media_info.extracted_text
                    else None
                ),
                extraction_status=(
                    file.extraction_status.value
                    if hasattr(file.extraction_status, "value")
                    else str(file.extraction_status)
                ),
            )
        )
    return files


class RuntimeHandlers:
    """RPC handlers for runtime service."""

    async def send_message(
        self,
        request: SendMessageRequest,
        ctx: RequestContext,
    ) -> SendMessageResponse:
        """Handle send_message RPC call.

        Stores the user message, calls the LLM, and stores the response.

        Parameters
        ----------
        request : SendMessageRequest
            The request with session ID and message content.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        SendMessageResponse
            User message, assistant message, and model used.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            session_id = UUID(request.session_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        if not request.content or not request.content.strip():
            raise ConnectError(Code.INVALID_ARGUMENT, "Message content cannot be empty")

        try:
            async for session in get_async_session():
                ops = RuntimeOperations(session)
                files = None
                if request.file_ids:
                    files = await _load_files(
                        session,
                        user_id,
                        org_id,
                        list(request.file_ids),
                    )
                user_msg, assistant_msg, model_used = await ops.send_message(
                    user_id=user_id,
                    organization_id=org_id,
                    session_id=session_id,
                    content=request.content.strip(),
                    files=files,
                    user_timezone=request.user_timezone or None,
                )
                return send_message_response_to_proto(
                    user_message=user_msg,
                    assistant_message=assistant_msg,
                    model_used=model_used,
                )

        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except RateLimitExceededError as e:
            raise ConnectError(Code.RESOURCE_EXHAUSTED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error in send_message: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def stream_send_message(
        self,
        request: SendMessageRequest,
        ctx: RequestContext,
    ) -> AsyncIterator[StreamSendMessageEvent]:
        """Handle stream_send_message server-streaming RPC.

        Stores the user message, calls the LLM with streaming, and yields
        token events, tool call/result events, and the final response as
        they become available.

        Parameters
        ----------
        request : SendMessageRequest
            The request with session ID and message content.
        ctx : RequestContext
            RPC request context.

        Yields
        ------
        StreamSendMessageEvent
            Streaming events (tokens, tool calls, tool results, done, error).

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            session_id = UUID(request.session_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        if not request.content or not request.content.strip():
            raise ConnectError(Code.INVALID_ARGUMENT, "Message content cannot be empty")

        try:
            async for session in get_async_session():
                ops = RuntimeOperations(session)
                files = None
                if request.file_ids:
                    files = await _load_files(
                        session,
                        user_id,
                        org_id,
                        list(request.file_ids),
                    )
                async for event in ops.stream_send_message(
                    user_id=user_id,
                    organization_id=org_id,
                    session_id=session_id,
                    content=request.content.strip(),
                    files=files,
                    user_timezone=request.user_timezone or None,
                ):
                    yield runtime_stream_event_to_proto(event)

        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except RateLimitExceededError as e:
            raise ConnectError(Code.RESOURCE_EXHAUSTED, str(e))
        except asyncio.CancelledError, GeneratorExit:
            logger.info("Stream send_message cancelled by client")
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error in stream_send_message: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def respond_to_confirmation(
        self,
        request: ConfirmationResponse,
        ctx: RequestContext,
    ) -> ConfirmationResponseAck:
        """Handle respond_to_confirmation RPC call.

        Sets the approval or rejection for a pending destructive tool call.

        Parameters
        ----------
        request : ConfirmationResponse
            The approval response with session ID, tool call ID, and decision.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        ConfirmationResponseAck
            Acknowledgment of the response.

        """
        get_user_id_from_context(ctx)

        try:
            session_id = UUID(request.session_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid session_id format")

        if not request.tool_call_id:
            raise ConnectError(Code.INVALID_ARGUMENT, "tool_call_id is required")

        store = get_approval_store()
        accepted = store.respond(session_id, request.tool_call_id, request.approved)

        return ConfirmationResponseAck(accepted=accepted)

    async def get_usage_stats(
        self,
        request: GetUsageStatsRequest,
        ctx: RequestContext,
    ) -> GetUsageStatsResponse:
        """Handle get_usage_stats RPC call.

        Returns aggregated usage statistics from agent run logs.
        Org admins and system admins see all usage across the organization.
        Regular members only see their own usage.

        Parameters
        ----------
        request : GetUsageStatsRequest
            The request with organization ID and optional day range.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        GetUsageStatsResponse
            Aggregated usage statistics.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id format")

        days = request.days if request.days > 0 else 30
        interval = request.interval if request.interval else "1d"

        try:
            async for session in get_async_session():
                # Determine whether user can see org-wide usage
                org_ops = OrganizationOperations(session)
                membership = await org_ops.require_org_member(user_id, org_id)

                user_result = await session.execute(
                    select(User.is_system_admin).where(User.id == user_id)
                )
                is_sys_admin = user_result.scalar_one_or_none() or False

                is_org_admin = membership.role in (
                    OrganizationRole.ADMIN,
                    OrganizationRole.OWNER,
                )

                # Non-admin users only see their own usage
                scoped_user_id = None if (is_org_admin or is_sys_admin) else user_id

                ops = UsageOperations(session)
                stats = await ops.get_usage_stats(
                    organization_id=org_id,
                    days=days,
                    interval=interval,
                    user_id=scoped_user_id,
                )
                return usage_stats_to_proto(stats)

        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error in get_usage_stats: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")
