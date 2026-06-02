"""RPC handlers for agent-in-chat interactions."""

from datetime import UTC, datetime
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from google.protobuf.timestamp_pb2 import Timestamp
from loguru import logger
from sqlalchemy import select
from uniffy_proto.chat.v1.chat_pb2 import (
    AgentConfirmationDecision,
    GetChannelPendingApprovalsRequest,
    GetChannelPendingApprovalsResponse,
    PendingAgentApproval,
    RespondToAgentConfirmationRequest,
    RespondToAgentConfirmationResponse,
    StopAgentRunRequest,
    StopAgentRunResponse,
)

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.valkey.streams import get_chat_active_run, request_run_cancel
from uniffy.db import open_session
from uniffy.domains.agents.chat_integration.operations import AgentChatBridge
from uniffy.domains.agents.runtime.approvals import get_approval_store
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.chat.feature_flags import is_chat_agents_enabled

logger = logger.bind(component="agents.chat_integration.handlers")

_DECISION_TO_STRING = {
    AgentConfirmationDecision.AGENT_CONFIRMATION_DECISION_APPROVE: "approved",
    AgentConfirmationDecision.AGENT_CONFIRMATION_DECISION_DENY: "denied",
}


def _handle_error(e: Exception) -> None:
    if isinstance(e, NotFoundError):
        raise ConnectError(Code.NOT_FOUND, str(e))
    if isinstance(e, PermissionDeniedError):
        raise ConnectError(Code.PERMISSION_DENIED, str(e))
    if isinstance(e, ValidationError):
        raise ConnectError(Code.INVALID_ARGUMENT, str(e))
    logger.exception(f"Unexpected error: {e}")
    raise ConnectError(Code.INTERNAL, "Internal error")


class AgentConfirmationHandlers:
    async def respond_to_agent_confirmation(
        self,
        request: RespondToAgentConfirmationRequest,
        ctx: RequestContext,
    ) -> RespondToAgentConfirmationResponse:
        """Resolve a destructive-tool approval raised by an agent."""
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
            message_id = UUID(request.message_id)
            request_id = UUID(request.request_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        decision_str = _DECISION_TO_STRING.get(request.decision)
        if decision_str is None:
            raise ConnectError(
                Code.INVALID_ARGUMENT,
                "decision must be APPROVE or DENY",
            )

        rationale = request.rationale if request.HasField("rationale") else None

        try:
            async with open_session() as session:
                if not await is_chat_agents_enabled(session, org_id):
                    raise ConnectError(
                        Code.FAILED_PRECONDITION,
                        "Agents-in-chat is not enabled for this organization",
                    )

                bridge = AgentChatBridge(session)
                await bridge.handle_confirmation_decision(
                    request_id=request_id,
                    channel_id=channel_id,
                    message_id=message_id,
                    decision=decision_str,
                    decided_by=user_id,
                    rationale=rationale,
                )

                decided_at = Timestamp()
                decided_at.FromDatetime(datetime.now(UTC))
                return RespondToAgentConfirmationResponse(
                    decision=request.decision,
                    decided_at=decided_at,
                )
        except (NotFoundError, PermissionDeniedError, ValidationError) as e:
            _handle_error(e)

    async def stop_agent_run(
        self,
        request: StopAgentRunRequest,
        ctx: RequestContext,
    ) -> StopAgentRunResponse:
        """Cancel the in-flight agent run for a (channel, agent) pair."""
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
            agent_id = UUID(request.agent_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                channel = (
                    await session.execute(
                        select(ChatChannel).where(
                            ChatChannel.id == channel_id,
                            ChatChannel.organization_id == org_id,
                        )
                    )
                ).scalar_one_or_none()
                if channel is None:
                    raise NotFoundError("channel", str(channel_id))

                access = ChatAccessChecker(session)
                await access.check_access(user_id, org_id, channel)

                run_id = await get_chat_active_run(channel_id, agent_id)
                if run_id is None:
                    return StopAgentRunResponse(stopped=False)
                stopped = await request_run_cancel(run_id)
                return StopAgentRunResponse(stopped=stopped)
        except (NotFoundError, PermissionDeniedError, ValidationError) as e:
            _handle_error(e)

    async def get_channel_pending_approvals(
        self,
        request: GetChannelPendingApprovalsRequest,
        ctx: RequestContext,
    ) -> GetChannelPendingApprovalsResponse:
        """Return open destructive-tool approvals awaiting a decision."""
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async with open_session() as session:
                if not await is_chat_agents_enabled(session, org_id):
                    return GetChannelPendingApprovalsResponse(approvals=[])

                channel = (
                    await session.execute(
                        select(ChatChannel).where(
                            ChatChannel.id == channel_id,
                            ChatChannel.organization_id == org_id,
                        )
                    )
                ).scalar_one_or_none()
                if channel is None:
                    raise NotFoundError("channel", str(channel_id))

                access = ChatAccessChecker(session)
                await access.check_access(user_id, org_id, channel)

                store = get_approval_store()
                rows = await store.list_pending_by_scope(channel_id)

                approvals = [_pending_to_proto(r) for r in rows]
                return GetChannelPendingApprovalsResponse(approvals=approvals)
        except (NotFoundError, PermissionDeniedError, ValidationError) as e:
            _handle_error(e)


def _pending_to_proto(row: dict) -> PendingAgentApproval:
    """Translate an ApprovalStore pending row into the proto shape."""
    requested_at = Timestamp()
    if raw := row.get("requested_at"):
        try:
            requested_at.FromDatetime(datetime.fromisoformat(raw))
        except ValueError:
            requested_at.FromDatetime(datetime.now(UTC))
    else:
        requested_at.FromDatetime(datetime.now(UTC))

    args_value = row.get("args_json")
    args_preview = "" if args_value is None else str(args_value)

    proto = PendingAgentApproval(
        request_id=str(row.get("request_id", "")),
        agent_id=str(row.get("agent_id", "")),
        message_id=str(row.get("message_id", "")),
        tool_name=str(row.get("tool_name", "")),
        args_preview=args_preview,
        actor_user_id=str(row.get("actor_user_id", "")),
        requested_at=requested_at,
    )
    return proto
