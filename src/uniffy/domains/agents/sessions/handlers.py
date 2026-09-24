"""Agent sessions RPC handlers - thin layer delegating to operations."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.agents.v1.sessions_pb import (
    CreateSessionRequest,
    CreateSessionResponse,
    EditMessageRequest,
    EditMessageResponse,
    GetSessionRequest,
    GetSessionResponse,
    ListMessagesRequest,
    ListMessagesResponse,
    RetryMessageRequest,
    RetryMessageResponse,
)
from uniffy_proto.common.v1.common_pb import PaginationResponse

from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.domains.agents.invocation import read_response_skill_attributions
from uniffy.domains.agents.sessions.converters import (
    message_to_proto,
    session_kind_from_proto,
    session_to_proto,
)
from uniffy.domains.agents.sessions.operations import SessionOperations
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="agents.sessions.handlers")


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
        user_id = current_user_id()

        try:
            org_id = resolve_organization_id(request.organization_id)
            agent_id = UUID(request.agent_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        kind = session_kind_from_proto(request.kind)

        display_name = request.display_name if request.has_field("display_name") else None
        model_override = request.model_override if request.has_field("model_override") else None

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
                    is_test=request.is_test,
                )
                return CreateSessionResponse(session=session_to_proto(agent_session))

        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.exception(f"Error creating session: {e}")
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
        user_id = current_user_id()

        try:
            org_id = resolve_organization_id(request.organization_id)
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
            logger.exception(f"Error getting session: {e}")
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
        user_id = current_user_id()

        try:
            org_id = resolve_organization_id(request.organization_id)
            session_id = UUID(request.session_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        # Parse pagination
        page = 1
        page_size = 50
        if request.has_field("pagination"):
            page = request.pagination.page if request.pagination.page > 0 else 1
            page_size = min(
                request.pagination.page_size if request.pagination.page_size > 0 else 50,
                200,
            )

        include_compacted = (
            request.include_compacted if request.has_field("include_compacted") else False
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
                attributions = await read_response_skill_attributions(
                    session,
                    organization_id=org_id,
                    session_id=session_id,
                    response_ids=[message.id for message in messages],
                )
                total_pages = (total + page_size - 1) // page_size if total > 0 else 0
                return ListMessagesResponse(
                    messages=[
                        message_to_proto(m, skill_invocation=attributions.get(m.id))
                        for m in messages
                    ],
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
            logger.exception(f"Error listing messages: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def edit_message(
        self,
        request: EditMessageRequest,
        ctx: RequestContext,
    ) -> EditMessageResponse:
        """Handle edit_message RPC call."""
        user_id = current_user_id()
        try:
            org_id = resolve_organization_id(request.organization_id)
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
            logger.exception(f"Error editing message: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def retry_message(
        self,
        request: RetryMessageRequest,
        ctx: RequestContext,
    ) -> RetryMessageResponse:
        """Handle retry_message RPC call."""
        user_id = current_user_id()
        try:
            org_id = resolve_organization_id(request.organization_id)
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
            logger.exception(f"Error retrying message: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")
