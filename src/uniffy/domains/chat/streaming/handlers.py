"""Chat streaming RPC handler.

StreamUserChatEvents: unified stream delivering both user-level events
(unread counts, thread activity, mentions) and channel-level events
(messages, typing, reactions) through a single persistent connection.

Channel events are fanned out at publish time to each member's
`chat:user:{user_id}` Valkey channel, so no per-channel subscription
is needed. The frontend filters by channel_id.
"""

import json
import time
from collections.abc import AsyncIterator
from contextlib import aclosing
from datetime import UTC, datetime

from connectrpc.request import RequestContext
from google.protobuf.timestamp_pb2 import Timestamp
from loguru import logger
from uniffy_proto.chat.v1.chat_pb2 import AgentConfirmationDecision
from uniffy_proto.chat.v1.chat_pb2 import (
    ChatChannel as ProtoChatChannel,
)
from uniffy_proto.chat.v1.chat_pb2 import (
    ChatMessage as ProtoChatMessage,
)
from uniffy_proto.chat.v1.chat_pb2 import (
    SenderType as ProtoSenderType,
)
from uniffy_proto.chat.v1.chat_stream_pb2 import (
    AgentConfirmationRequestedPayload,
    AgentConfirmationResolvedPayload,
    AgentTokenDeltaPayload,
    AgentToolCallPayload,
    AgentTypingPayload,
    ChatEvent,
    ChatEventType,
    MemberPayload,
    MembersChangedPayload,
    MentionReceivedPayload,
    MessageDeletedPayload,
    ReactionPayload,
    StreamUserChatEventsRequest,
    ThreadActivityPayload,
    ThreadUpdatedPayload,
    TypingPayload,
    UnreadCountPayload,
    UserChatEvent,
    UserChatEventType,
)

from uniffy.core.valkey import subscribe_channels
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.chat.streaming import events as evt
from uniffy.domains.notifications.middleware import get_disconnect_event

LOGGER_COMPONENT = "chat.stream"
HEARTBEAT_INTERVAL = 30  # seconds


def _now_ts() -> Timestamp:
    """Create a protobuf Timestamp for now."""
    ts = Timestamp()
    ts.FromDatetime(datetime.now(UTC))
    return ts


def _payload_to_channel_event(payload: dict) -> ChatEvent | None:
    """Convert a Valkey payload dict to a ChatEvent proto.

    Every ChatEvent carries channel_id so the frontend can filter
    events for the active channel.
    """
    event_type = payload.get("_type")
    cid = payload.get("channel_id", "")

    if event_type == evt.MESSAGE_CREATED:
        return ChatEvent(
            event_type=ChatEventType.CHAT_EVENT_TYPE_MESSAGE_CREATED,
            timestamp=_now_ts(),
            channel_id=cid,
            message=_build_message_proto(payload),
        )

    if event_type == evt.MESSAGE_UPDATED:
        return ChatEvent(
            event_type=ChatEventType.CHAT_EVENT_TYPE_MESSAGE_UPDATED,
            timestamp=_now_ts(),
            channel_id=cid,
            message=_build_message_proto(payload),
        )

    if event_type == evt.MESSAGE_DELETED:
        return ChatEvent(
            event_type=ChatEventType.CHAT_EVENT_TYPE_MESSAGE_DELETED,
            timestamp=_now_ts(),
            channel_id=cid,
            message_deleted=MessageDeletedPayload(
                message_id=payload.get("message_id", ""),
            ),
        )

    if event_type == evt.REACTION_ADDED:
        return ChatEvent(
            event_type=ChatEventType.CHAT_EVENT_TYPE_REACTION_ADDED,
            timestamp=_now_ts(),
            channel_id=cid,
            reaction=ReactionPayload(
                message_id=payload.get("message_id", ""),
                emoji=payload.get("emoji", ""),
                user_id=payload.get("user_id", ""),
                display_name=payload.get("display_name", ""),
            ),
        )

    if event_type == evt.REACTION_REMOVED:
        return ChatEvent(
            event_type=ChatEventType.CHAT_EVENT_TYPE_REACTION_REMOVED,
            timestamp=_now_ts(),
            channel_id=cid,
            reaction=ReactionPayload(
                message_id=payload.get("message_id", ""),
                emoji=payload.get("emoji", ""),
                user_id=payload.get("user_id", ""),
                display_name=payload.get("display_name", ""),
            ),
        )

    if event_type == evt.TYPING_STARTED:
        return ChatEvent(
            event_type=ChatEventType.CHAT_EVENT_TYPE_TYPING_STARTED,
            timestamp=_now_ts(),
            channel_id=cid,
            typing=TypingPayload(
                user_id=payload.get("user_id", ""),
                display_name=payload.get("display_name", ""),
            ),
        )

    if event_type == evt.MEMBER_JOINED:
        return ChatEvent(
            event_type=ChatEventType.CHAT_EVENT_TYPE_MEMBER_JOINED,
            timestamp=_now_ts(),
            channel_id=cid,
            member=MemberPayload(
                user_id=payload.get("user_id", ""),
                display_name=payload.get("display_name", ""),
                avatar_url=payload.get("avatar_url", ""),
            ),
        )

    if event_type == evt.MEMBER_LEFT:
        return ChatEvent(
            event_type=ChatEventType.CHAT_EVENT_TYPE_MEMBER_LEFT,
            timestamp=_now_ts(),
            channel_id=cid,
            member=MemberPayload(
                user_id=payload.get("user_id", ""),
                display_name=payload.get("display_name", ""),
            ),
        )

    if event_type == evt.MEMBERS_ADDED:
        return ChatEvent(
            event_type=ChatEventType.CHAT_EVENT_TYPE_MEMBERS_ADDED,
            timestamp=_now_ts(),
            channel_id=cid,
            members_changed=MembersChangedPayload(
                user_ids=payload.get("user_ids", []),
            ),
        )

    if event_type == evt.MEMBERS_REMOVED:
        return ChatEvent(
            event_type=ChatEventType.CHAT_EVENT_TYPE_MEMBERS_REMOVED,
            timestamp=_now_ts(),
            channel_id=cid,
            members_changed=MembersChangedPayload(
                user_ids=payload.get("user_ids", []),
            ),
        )

    if event_type == evt.THREAD_UPDATED:
        event = ChatEvent(
            event_type=ChatEventType.CHAT_EVENT_TYPE_THREAD_UPDATED,
            timestamp=_now_ts(),
            channel_id=cid,
            thread_updated=ThreadUpdatedPayload(
                root_message_id=payload.get("root_message_id", ""),
                reply_count=payload.get("reply_count", 0),
                latest_participant_id=payload.get("latest_participant_id", ""),
            ),
        )
        if payload.get("last_reply_at"):
            ts = Timestamp()
            ts.FromDatetime(datetime.fromisoformat(payload["last_reply_at"]))
            event.thread_updated.last_reply_at.CopyFrom(ts)
        return event

    if event_type == evt.CHANNEL_UPDATED:
        return ChatEvent(
            event_type=ChatEventType.CHAT_EVENT_TYPE_CHANNEL_UPDATED,
            timestamp=_now_ts(),
            channel_id=cid,
            channel_updated=ProtoChatChannel(
                id=cid,
                is_archived=payload.get("is_archived", False),
            ),
        )

    if event_type == evt.AGENT_TYPING:
        typing_msg = AgentTypingPayload(
            agent_id=payload.get("agent_id", ""),
            display_name=payload.get("display_name", ""),
            started=payload.get("started", True),
        )
        if payload.get("root_id"):
            typing_msg.root_id = payload["root_id"]
        return ChatEvent(
            event_type=ChatEventType.CHAT_EVENT_TYPE_AGENT_TYPING,
            timestamp=_now_ts(),
            channel_id=cid,
            agent_typing=typing_msg,
        )

    if event_type == evt.AGENT_TOKEN_DELTA:
        return ChatEvent(
            event_type=ChatEventType.CHAT_EVENT_TYPE_AGENT_TOKEN_DELTA,
            timestamp=_now_ts(),
            channel_id=cid,
            agent_token_delta=AgentTokenDeltaPayload(
                message_id=payload.get("message_id", ""),
                agent_id=payload.get("agent_id", ""),
                delta=payload.get("delta", ""),
                sequence=int(payload.get("sequence", 0)),
                final=bool(payload.get("final", False)),
            ),
        )

    if event_type == evt.AGENT_TOOL_CALL:
        status_str = payload.get("status", "STARTED")
        status_map = {
            "STARTED": AgentToolCallPayload.STATUS_STARTED,
            "COMPLETED": AgentToolCallPayload.STATUS_COMPLETED,
            "FAILED": AgentToolCallPayload.STATUS_FAILED,
        }
        return ChatEvent(
            event_type=ChatEventType.CHAT_EVENT_TYPE_AGENT_TOOL_CALL,
            timestamp=_now_ts(),
            channel_id=cid,
            agent_tool_call=AgentToolCallPayload(
                message_id=payload.get("message_id", ""),
                agent_id=payload.get("agent_id", ""),
                tool_name=payload.get("tool_name", ""),
                tool_call_id=payload.get("tool_call_id", ""),
                status=status_map.get(status_str, AgentToolCallPayload.STATUS_UNSPECIFIED),
                preview=payload.get("preview") or "",
                error_message=payload.get("error_message") or "",
            ),
        )

    if event_type == evt.AGENT_CONFIRMATION_REQUESTED:
        event = ChatEvent(
            event_type=ChatEventType.CHAT_EVENT_TYPE_AGENT_CONFIRMATION_REQUESTED,
            timestamp=_now_ts(),
            channel_id=cid,
            agent_confirmation_requested=AgentConfirmationRequestedPayload(
                message_id=payload.get("message_id", ""),
                agent_id=payload.get("agent_id", ""),
                request_id=payload.get("request_id", ""),
                tool_name=payload.get("tool_name", ""),
                args_preview=payload.get("args_preview", ""),
                actor_user_id=payload.get("actor_user_id", ""),
            ),
        )
        if payload.get("expires_at"):
            ts = Timestamp()
            ts.FromDatetime(datetime.fromisoformat(payload["expires_at"]))
            event.agent_confirmation_requested.expires_at.CopyFrom(ts)
        return event

    if event_type == evt.AGENT_CONFIRMATION_RESOLVED:
        decision_str = payload.get("decision", "approved")
        decision_map = {
            "approved": AgentConfirmationDecision.AGENT_CONFIRMATION_DECISION_APPROVE,
            "denied": AgentConfirmationDecision.AGENT_CONFIRMATION_DECISION_DENY,
        }
        event = ChatEvent(
            event_type=ChatEventType.CHAT_EVENT_TYPE_AGENT_CONFIRMATION_RESOLVED,
            timestamp=_now_ts(),
            channel_id=cid,
            agent_confirmation_resolved=AgentConfirmationResolvedPayload(
                message_id=payload.get("message_id", ""),
                request_id=payload.get("request_id", ""),
                decision=decision_map.get(
                    decision_str,
                    AgentConfirmationDecision.AGENT_CONFIRMATION_DECISION_UNSPECIFIED,
                ),
                decided_by_user_id=payload.get("decided_by_user_id", ""),
            ),
        )
        if payload.get("decided_at"):
            ts = Timestamp()
            ts.FromDatetime(datetime.fromisoformat(payload["decided_at"]))
            event.agent_confirmation_resolved.decided_at.CopyFrom(ts)
        return event

    return None


_SENDER_TYPE_STR_TO_PROTO = {
    "USER": ProtoSenderType.SENDER_TYPE_USER,
    "AGENT": ProtoSenderType.SENDER_TYPE_AGENT,
    "SYSTEM": ProtoSenderType.SENDER_TYPE_SYSTEM,
    "GUEST": ProtoSenderType.SENDER_TYPE_GUEST,
}


def _build_message_proto(payload: dict) -> ProtoChatMessage:
    """Build a ChatMessage proto from a Valkey payload."""
    msg = ProtoChatMessage(
        id=payload.get("message_id", ""),
        channel_id=payload.get("channel_id", ""),
        sender_id=payload.get("sender_id", ""),
        sender_type=_SENDER_TYPE_STR_TO_PROTO.get(
            payload.get("sender_type", "USER"),
            ProtoSenderType.SENDER_TYPE_USER,
        ),
        content=payload.get("content", ""),
        is_pinned=payload.get("is_pinned", False),
        is_deleted=False,
    )
    if payload.get("root_id"):
        msg.root_id = payload["root_id"]
    if payload.get("reply_to_id"):
        msg.reply_to_id = payload["reply_to_id"]
    if payload.get("reply_context"):
        from uniffy_proto.chat.v1.chat_pb2 import ReplyContext as ProtoReplyContext

        rc = payload["reply_context"]
        msg.reply_context.CopyFrom(
            ProtoReplyContext(
                id=rc.get("id", ""),
                sender_name=rc.get("sender_name", ""),
                content_preview=rc.get("content_preview", ""),
            )
        )
    if payload.get("sender_name"):
        msg.sender_name = payload["sender_name"]
    if payload.get("sender_avatar_url"):
        msg.sender_avatar_url = payload["sender_avatar_url"]
    if payload.get("created_at"):
        ts = Timestamp()
        ts.FromDatetime(datetime.fromisoformat(payload["created_at"]))
        msg.created_at.CopyFrom(ts)
    if payload.get("edited_at"):
        ts = Timestamp()
        ts.FromDatetime(datetime.fromisoformat(payload["edited_at"]))
        msg.edited_at.CopyFrom(ts)

    # Copy metadata (map<string, string>) so agent `kind` dispatch works on
    # the first MESSAGE_CREATED event. Dropping it here caused agent tool
    # calls / tool results / summaries to transiently render as plain
    # markdown until a subsequent GetMessages refetch pulled metadata from
    # the DB. Values are stringified since the proto map only accepts
    # strings; the frontend renderer already treats them as opaque.
    meta = payload.get("metadata")
    if isinstance(meta, dict):
        for k, v in meta.items():
            msg.metadata[str(k)] = v if isinstance(v, str) else json.dumps(v, default=str)

    return msg


def _payload_to_user_event(payload: dict) -> UserChatEvent | None:
    """Convert a Valkey payload dict to a UserChatEvent proto."""
    event_type = payload.get("_type")

    if event_type == evt.UNREAD_COUNT_CHANGED:
        return UserChatEvent(
            event_type=UserChatEventType.USER_CHAT_EVENT_TYPE_UNREAD_COUNT_CHANGED,
            timestamp=_now_ts(),
            unread_count=UnreadCountPayload(
                channel_id=payload.get("channel_id", ""),
                unread_count=payload.get("unread_count", 0),
                mention_count=payload.get("mention_count", 0),
            ),
        )

    if event_type == evt.THREAD_ACTIVITY:
        event = UserChatEvent(
            event_type=UserChatEventType.USER_CHAT_EVENT_TYPE_THREAD_ACTIVITY,
            timestamp=_now_ts(),
            thread_activity=ThreadActivityPayload(
                root_message_id=payload.get("root_message_id", ""),
                channel_id=payload.get("channel_id", ""),
                channel_name=payload.get("channel_name", ""),
                reply_count=payload.get("reply_count", 0),
            ),
        )
        if payload.get("last_reply_at"):
            ts = Timestamp()
            ts.FromDatetime(datetime.fromisoformat(payload["last_reply_at"]))
            event.thread_activity.last_reply_at.CopyFrom(ts)
        return event

    if event_type == evt.MENTION_RECEIVED:
        return UserChatEvent(
            event_type=UserChatEventType.USER_CHAT_EVENT_TYPE_MENTION_RECEIVED,
            timestamp=_now_ts(),
            mention_received=MentionReceivedPayload(
                channel_id=payload.get("channel_id", ""),
                channel_name=payload.get("channel_name", ""),
                message_id=payload.get("message_id", ""),
                sender_id=payload.get("sender_id", ""),
                sender_name=payload.get("sender_name", ""),
                preview=payload.get("preview", ""),
            ),
        )

    return None


# Channel-level event types that arrive via fan-out on chat:user:{user_id}
_CHANNEL_EVENT_TYPES = {
    evt.MESSAGE_CREATED,
    evt.MESSAGE_UPDATED,
    evt.MESSAGE_DELETED,
    evt.REACTION_ADDED,
    evt.REACTION_REMOVED,
    evt.TYPING_STARTED,
    evt.TYPING_STOPPED,
    evt.MEMBER_JOINED,
    evt.MEMBER_LEFT,
    evt.MEMBERS_ADDED,
    evt.MEMBERS_REMOVED,
    evt.CHANNEL_UPDATED,
    evt.THREAD_UPDATED,
    evt.AGENT_TYPING,
    evt.AGENT_TOKEN_DELTA,
    evt.AGENT_TOOL_CALL,
    evt.AGENT_CONFIRMATION_REQUESTED,
    evt.AGENT_CONFIRMATION_RESOLVED,
}


class ChatStreamHandlers:
    """Chat streaming RPC handlers."""

    async def stream_user_chat_events(
        self,
        request: StreamUserChatEventsRequest,
        ctx: RequestContext,
    ) -> AsyncIterator[UserChatEvent]:
        """Unified chat event stream.

        Subscribes to the user's single Valkey channel `chat:user:{user_id}`.
        All events (user-level and channel-level) arrive here because the
        publisher fans out channel events to each member's user channel.

        The frontend filters channel events by channel_id to display only
        the active channel's events.
        """
        user_id = get_user_id_from_context(ctx)

        logger.info(
            f"starting unified chat stream for {user_id}",
            component=LOGGER_COMPONENT,
        )
        disconnect = get_disconnect_event()

        try:
            async with aclosing(subscribe_channels(f"chat:user:{user_id}")) as subscriber:
                last_send = time.monotonic()

                async for payload in subscriber:
                    if disconnect and disconnect.is_set():
                        break

                    now = time.monotonic()

                    if payload is None:
                        if now - last_send >= HEARTBEAT_INTERVAL:
                            yield UserChatEvent(
                                event_type=UserChatEventType.USER_CHAT_EVENT_TYPE_HEARTBEAT,
                                timestamp=_now_ts(),
                            )
                            last_send = now
                        continue

                    event_type = payload.get("_type")

                    # Channel-level event (fanned out from publisher)
                    if event_type in _CHANNEL_EVENT_TYPES:
                        channel_event = _payload_to_channel_event(payload)
                        if channel_event:
                            yield UserChatEvent(
                                event_type=UserChatEventType.USER_CHAT_EVENT_TYPE_CHANNEL_EVENT,
                                timestamp=_now_ts(),
                                channel_event=channel_event,
                            )
                            last_send = now
                        continue

                    # User-level event
                    user_event = _payload_to_user_event(payload)
                    if user_event:
                        yield user_event
                        last_send = now

        except GeneratorExit:
            logger.info(
                f"unified chat stream generator closed for {user_id}",
                component=LOGGER_COMPONENT,
            )
