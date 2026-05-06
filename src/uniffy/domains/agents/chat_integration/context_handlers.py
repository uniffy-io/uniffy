"""RPC handlers for per-(channel, agent) context management.

Three RPCs on `chat.v1.ChatService`:

- `GetChannelAgentContextStats` -- read binding + count chat messages.
- `CompactChannelAgentContext` -- force compaction (deferred to Phase 8c;
  currently raises FAILED_PRECONDITION).
- `ResetChannelAgentContext` -- write a `kind=context_reset` divider and
  set `binding.manual_reset_at`. The runtime's
  `ChatChannelMessageWriter.load_context_messages` honours both.

When the chat.agents_enabled flag is off all three return
FAILED_PRECONDITION. The handlers are mixed into `ChatServiceImpl` so
the chat service is the single front door.
"""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from google.protobuf.timestamp_pb2 import Timestamp
from loguru import logger
from uniffy_proto.chat.v1.chat_pb2 import (
    ChannelAgentContextStats as ProtoChannelAgentContextStats,
)
from uniffy_proto.chat.v1.chat_pb2 import (
    CompactChannelAgentContextRequest,
    CompactChannelAgentContextResponse,
    GetChannelAgentContextStatsBatchRequest,
    GetChannelAgentContextStatsBatchResponse,
    GetChannelAgentContextStatsRequest,
    GetChannelAgentContextStatsResponse,
    ResetChannelAgentContextRequest,
    ResetChannelAgentContextResponse,
)

from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.db import open_session
from uniffy.domains.agents.chat_integration.context import (
    ChatAgentContextOperations,
    ContextStats,
)
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.chat.feature_flags import is_chat_agents_enabled


def _stats_to_proto(stats: ContextStats) -> ProtoChannelAgentContextStats:
    """Translate the dataclass into the proto wire shape."""
    proto = ProtoChannelAgentContextStats(
        total_messages=stats.total_messages,
        active_messages=stats.active_messages,
        compacted_messages=stats.compacted_messages,
        summary_count=stats.summary_count,
        active_tokens=stats.active_tokens,
        last_input_tokens=stats.last_input_tokens,
        last_output_tokens=stats.last_output_tokens,
        last_cache_read_tokens=stats.last_cache_read_tokens,
        token_budget=stats.token_budget,
        tokens_until_compaction=stats.tokens_until_compaction,
        context_window_tokens=stats.context_window_tokens,
        was_reset=stats.was_reset,
    )
    if stats.manual_reset_at is not None:
        ts = Timestamp()
        ts.FromDatetime(stats.manual_reset_at)
        proto.manual_reset_at.CopyFrom(ts)
    return proto


def _parse_ids(*raw: str) -> list[UUID]:
    try:
        return [UUID(r) for r in raw]
    except ValueError:
        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")


def _handle_error(e: Exception) -> None:
    if isinstance(e, NotFoundError):
        raise ConnectError(Code.NOT_FOUND, str(e))
    if isinstance(e, PermissionDeniedError):
        raise ConnectError(Code.PERMISSION_DENIED, str(e))
    if isinstance(e, ValidationError):
        raise ConnectError(Code.FAILED_PRECONDITION, str(e))
    logger.exception(f"Unexpected error in channel context handler: {e}")
    raise ConnectError(Code.INTERNAL, "Internal error")


class ChannelAgentContextHandlers:
    """Mixin providing the three context RPCs on the chat service."""

    async def get_channel_agent_context_stats(
        self,
        request: GetChannelAgentContextStatsRequest,
        ctx: RequestContext,
    ) -> GetChannelAgentContextStatsResponse:
        """Read context stats for one (channel, agent) pair."""
        user_id = get_user_id_from_context(ctx)
        org_id, channel_id, agent_id = _parse_ids(
            request.organization_id, request.channel_id, request.agent_id
        )

        try:
            async with open_session() as session:
                if not await is_chat_agents_enabled(session, org_id):
                    raise ConnectError(
                        Code.FAILED_PRECONDITION,
                        "Agents-in-chat is not enabled for this organization",
                    )
                ops = ChatAgentContextOperations(session)
                stats = await ops.get_stats(
                    user_id=user_id,
                    organization_id=org_id,
                    channel_id=channel_id,
                    agent_id=agent_id,
                )
                return GetChannelAgentContextStatsResponse(stats=_stats_to_proto(stats))
        except ConnectError:
            raise
        except (NotFoundError, PermissionDeniedError, ValidationError) as e:
            _handle_error(e)

    async def get_channel_agent_context_stats_batch(
        self,
        request: GetChannelAgentContextStatsBatchRequest,
        ctx: RequestContext,
    ) -> GetChannelAgentContextStatsBatchResponse:
        """Batched stats for N (channel, agent) pairs in one round-trip."""
        user_id = get_user_id_from_context(ctx)
        org_id, channel_id = _parse_ids(request.organization_id, request.channel_id)
        agent_ids = _parse_ids(*request.agent_ids) if request.agent_ids else []

        try:
            async with open_session() as session:
                if not await is_chat_agents_enabled(session, org_id):
                    raise ConnectError(
                        Code.FAILED_PRECONDITION,
                        "Agents-in-chat is not enabled for this organization",
                    )
                ops = ChatAgentContextOperations(session)
                stats_map = await ops.get_stats_for_agents(
                    user_id=user_id,
                    organization_id=org_id,
                    channel_id=channel_id,
                    agent_ids=agent_ids,
                )
                response = GetChannelAgentContextStatsBatchResponse()
                for agent_id, stats in stats_map.items():
                    response.stats[str(agent_id)].CopyFrom(_stats_to_proto(stats))
                return response
        except ConnectError:
            raise
        except (NotFoundError, PermissionDeniedError, ValidationError) as e:
            _handle_error(e)

    async def compact_channel_agent_context(
        self,
        request: CompactChannelAgentContextRequest,
        ctx: RequestContext,
    ) -> CompactChannelAgentContextResponse:
        """Force compaction for one (channel, agent) pair (Phase 8c)."""
        user_id = get_user_id_from_context(ctx)
        org_id, channel_id, agent_id = _parse_ids(
            request.organization_id, request.channel_id, request.agent_id
        )

        try:
            async with open_session() as session:
                if not await is_chat_agents_enabled(session, org_id):
                    raise ConnectError(
                        Code.FAILED_PRECONDITION,
                        "Agents-in-chat is not enabled for this organization",
                    )
                ops = ChatAgentContextOperations(session)
                result = await ops.compact(
                    user_id=user_id,
                    organization_id=org_id,
                    channel_id=channel_id,
                    agent_id=agent_id,
                )
                return CompactChannelAgentContextResponse(
                    compacted=result.compacted,
                    stats=_stats_to_proto(result.stats),
                    messages_compacted=result.messages_compacted,
                    tokens_before=result.tokens_before,
                    tokens_after=result.tokens_after,
                    tokens_saved=result.tokens_saved,
                )
        except ConnectError:
            raise
        except (NotFoundError, PermissionDeniedError, ValidationError) as e:
            _handle_error(e)

    async def reset_channel_agent_context(
        self,
        request: ResetChannelAgentContextRequest,
        ctx: RequestContext,
    ) -> ResetChannelAgentContextResponse:
        """Drop the agent's view of pre-now history (per-agent semantics)."""
        user_id = get_user_id_from_context(ctx)
        org_id, channel_id, agent_id = _parse_ids(
            request.organization_id, request.channel_id, request.agent_id
        )

        try:
            async with open_session() as session:
                if not await is_chat_agents_enabled(session, org_id):
                    raise ConnectError(
                        Code.FAILED_PRECONDITION,
                        "Agents-in-chat is not enabled for this organization",
                    )
                ops = ChatAgentContextOperations(session)
                result = await ops.reset(
                    user_id=user_id,
                    organization_id=org_id,
                    channel_id=channel_id,
                    agent_id=agent_id,
                )

                reset_at_ts = Timestamp()
                reset_at_ts.FromDatetime(result.reset_at)
                return ResetChannelAgentContextResponse(
                    divider_message_id=str(result.divider_message_id),
                    reset_at=reset_at_ts,
                    stats=_stats_to_proto(result.stats),
                )
        except ConnectError:
            raise
        except (NotFoundError, PermissionDeniedError, ValidationError) as e:
            _handle_error(e)
