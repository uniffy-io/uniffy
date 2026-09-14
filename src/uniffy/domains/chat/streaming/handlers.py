"""Unified chat event stream over a single `chat:user:{user_id}` subscription."""

import time
from collections.abc import AsyncIterator
from contextlib import aclosing
from datetime import UTC, datetime

from connectrpc.request import RequestContext
from google.protobuf.timestamp_pb2 import Timestamp
from loguru import logger
from uniffy_proto.calls.v1.calls_pb2 import (
    Call as ProtoCall,
)
from uniffy_proto.calls.v1.calls_pb2 import (
    CallEndReason as ProtoCallEndReason,
)
from uniffy_proto.calls.v1.calls_pb2 import (
    CallParticipant as ProtoCallParticipant,
)
from uniffy_proto.calls.v1.calls_pb2 import (
    CallType as ProtoCallType,
)
from uniffy_proto.chat.v1.chat_pb2 import AgentConfirmationDecision
from uniffy_proto.chat.v1.chat_pb2 import (
    ChannelRole as ProtoChannelRole,
)
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
    AgentThinkingDeltaPayload,
    AgentTokenDeltaPayload,
    AgentToolCallPayload,
    AgentTypingPayload,
    CallHostChangedPayload,
    CallLifecyclePayload,
    CallParticipantEventPayload,
    CallRingPayload,
    ChatEvent,
    ChatEventType,
    DraftChangedPayload,
    MemberPayload,
    MembersChangedPayload,
    MentionReceivedPayload,
    MessageDeletedPayload,
    ReactionPayload,
    StreamUserChatEventsRequest,
    StreamUserChatEventsResponse,
    ThreadActivityPayload,
    ThreadUpdatedPayload,
    TypingPayload,
    UnreadCountPayload,
    UserChatEventType,
)

from uniffy.core.auth.principal import current_user_id
from uniffy.core.json_codec import dumps_str
from uniffy.core.models.chat.message import ChatMessageMetadataKey
from uniffy.core.streaming.disconnect import get_disconnect_event
from uniffy.domains.chat.messages.converters import forward_context_to_proto
from uniffy.domains.chat.streaming import events as evt
from uniffy.infrastructure.valkey.pubsub import subscribe_channels

LOGGER_COMPONENT = "chat.stream"
HEARTBEAT_INTERVAL = 30


def _now_ts() -> Timestamp:
    ts = Timestamp()
    ts.FromDatetime(datetime.now(UTC))
    return ts


def _payload_to_channel_event(payload: dict) -> ChatEvent | None:
    """Valkey payload -> ChatEvent proto; every event carries channel_id for client filtering."""
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

    if event_type == evt.MEMBER_UPDATED:
        role_by_name = {
            "MEMBER": ProtoChannelRole.CHANNEL_ROLE_MEMBER,
            "ADMIN": ProtoChannelRole.CHANNEL_ROLE_ADMIN,
            "OWNER": ProtoChannelRole.CHANNEL_ROLE_OWNER,
        }
        return ChatEvent(
            event_type=ChatEventType.CHAT_EVENT_TYPE_MEMBER_UPDATED,
            timestamp=_now_ts(),
            channel_id=cid,
            member=MemberPayload(
                user_id=payload.get("user_id", ""),
                display_name=payload.get("display_name", ""),
                role=role_by_name.get(
                    payload.get("role", "MEMBER"), ProtoChannelRole.CHANNEL_ROLE_MEMBER
                ),
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

    if event_type == evt.CHANNEL_CREATED:
        return ChatEvent(
            event_type=ChatEventType.CHAT_EVENT_TYPE_CHANNEL_CREATED,
            timestamp=_now_ts(),
            channel_id=cid,
        )

    if event_type == evt.CHANNEL_UPDATED:
        return ChatEvent(
            event_type=ChatEventType.CHAT_EVENT_TYPE_CHANNEL_UPDATED,
            timestamp=_now_ts(),
            channel_id=cid,
            channel_updated=ProtoChatChannel(
                id=cid,
                # Removal (archive or delete) is the only state this stub
                # carries; every other edit is hydrated by the recipient.
                is_archived=payload.get("is_archived", False) or payload.get("is_deleted", False),
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

    if event_type == evt.AGENT_THINKING_DELTA:
        return ChatEvent(
            event_type=ChatEventType.CHAT_EVENT_TYPE_AGENT_THINKING_DELTA,
            timestamp=_now_ts(),
            channel_id=cid,
            agent_thinking_delta=AgentThinkingDeltaPayload(
                message_id=payload.get("message_id", ""),
                agent_id=payload.get("agent_id", ""),
                block_id=payload.get("block_id", ""),
                delta=payload.get("delta", ""),
                sequence=int(payload.get("sequence", 0)),
                final=bool(payload.get("final", False)),
                elapsed_ms=int(payload.get("elapsed_ms", 0)),
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

    if event_type == evt.CALL_STARTED or event_type == evt.CALL_ENDED:
        is_started = event_type == evt.CALL_STARTED
        return ChatEvent(
            event_type=(
                ChatEventType.CHAT_EVENT_TYPE_CALL_STARTED
                if is_started
                else ChatEventType.CHAT_EVENT_TYPE_CALL_ENDED
            ),
            timestamp=_now_ts(),
            channel_id=cid,
            call_lifecycle=CallLifecyclePayload(
                call=_build_call_proto(payload.get("call") or {}),
            ),
        )

    if event_type in (
        evt.CALL_PARTICIPANT_JOINED,
        evt.CALL_PARTICIPANT_LEFT,
        evt.CALL_PARTICIPANT_STATE,
    ):
        call_event_types = {
            evt.CALL_PARTICIPANT_JOINED: ChatEventType.CHAT_EVENT_TYPE_CALL_PARTICIPANT_JOINED,
            evt.CALL_PARTICIPANT_LEFT: ChatEventType.CHAT_EVENT_TYPE_CALL_PARTICIPANT_LEFT,
            evt.CALL_PARTICIPANT_STATE: ChatEventType.CHAT_EVENT_TYPE_CALL_PARTICIPANT_STATE,
        }
        return ChatEvent(
            event_type=call_event_types[event_type],
            timestamp=_now_ts(),
            channel_id=cid,
            call_participant=CallParticipantEventPayload(
                call_id=payload.get("call_id", ""),
                participant=_build_call_participant_proto(payload.get("participant") or {}),
                active_participant_count=int(payload.get("active_participant_count", 0)),
            ),
        )

    if event_type == evt.CALL_RING:
        event = ChatEvent(
            event_type=ChatEventType.CHAT_EVENT_TYPE_CALL_RING,
            timestamp=_now_ts(),
            channel_id=cid,
            call_ring=CallRingPayload(
                call_id=payload.get("call_id", ""),
                channel_name=payload.get("channel_name", ""),
                call_type=_CALL_TYPE_STR_TO_PROTO.get(
                    payload.get("call_type", ""), ProtoCallType.CALL_TYPE_UNSPECIFIED
                ),
                caller_user_id=payload.get("caller_user_id", ""),
                caller_name=payload.get("caller_name", ""),
                caller_avatar_url=payload.get("caller_avatar_url") or "",
            ),
        )
        if payload.get("expires_at"):
            ts = Timestamp()
            ts.FromDatetime(datetime.fromisoformat(payload["expires_at"]))
            event.call_ring.expires_at.CopyFrom(ts)
        return event

    if event_type == evt.CALL_HOST_CHANGED:
        return ChatEvent(
            event_type=ChatEventType.CHAT_EVENT_TYPE_CALL_HOST_CHANGED,
            timestamp=_now_ts(),
            channel_id=cid,
            call_host_changed=CallHostChangedPayload(
                call_id=payload.get("call_id", ""),
                new_host_user_id=payload.get("new_host_user_id", ""),
            ),
        )

    return None


_CALL_TYPE_STR_TO_PROTO = {
    "DIRECT": ProtoCallType.CALL_TYPE_DIRECT,
    "GROUP_DM": ProtoCallType.CALL_TYPE_GROUP_DM,
    "CHANNEL": ProtoCallType.CALL_TYPE_CHANNEL,
}

_CALL_END_REASON_STR_TO_PROTO = {
    "HOST_ENDED": ProtoCallEndReason.CALL_END_REASON_HOST_ENDED,
    "ALL_LEFT": ProtoCallEndReason.CALL_END_REASON_ALL_LEFT,
    "MAX_DURATION": ProtoCallEndReason.CALL_END_REASON_MAX_DURATION,
    "SOLO_TIMEOUT": ProtoCallEndReason.CALL_END_REASON_SOLO_TIMEOUT,
    "CHANNEL_ARCHIVED": ProtoCallEndReason.CALL_END_REASON_CHANNEL_ARCHIVED,
}


def _build_call_participant_proto(participant: dict) -> ProtoCallParticipant:
    proto = ProtoCallParticipant(
        user_id=participant.get("user_id", ""),
        device_id=participant.get("device_id", ""),
        identity=participant.get("identity", ""),
        display_name=participant.get("display_name", ""),
        avatar_url=participant.get("avatar_url") or "",
        device_label=participant.get("device_label") or "",
        mic_enabled=bool(participant.get("mic_enabled", True)),
        camera_enabled=bool(participant.get("camera_enabled", False)),
        screen_sharing=bool(participant.get("screen_sharing", False)),
    )
    if participant.get("joined_at"):
        ts = Timestamp()
        ts.FromDatetime(datetime.fromisoformat(participant["joined_at"]))
        proto.joined_at.CopyFrom(ts)
    return proto


def _build_call_proto(call: dict) -> ProtoCall:
    proto = ProtoCall(
        id=call.get("call_id", ""),
        organization_id=call.get("organization_id", ""),
        channel_id=call.get("channel_id", ""),
        call_type=_CALL_TYPE_STR_TO_PROTO.get(
            call.get("call_type", ""), ProtoCallType.CALL_TYPE_UNSPECIFIED
        ),
        initiator_user_id=call.get("initiator_user_id", ""),
        host_user_id=call.get("host_user_id", ""),
        participants=[_build_call_participant_proto(p) for p in call.get("participants", [])],
    )
    if call.get("started_at"):
        ts = Timestamp()
        ts.FromDatetime(datetime.fromisoformat(call["started_at"]))
        proto.started_at.CopyFrom(ts)
    if call.get("ended_at"):
        ts = Timestamp()
        ts.FromDatetime(datetime.fromisoformat(call["ended_at"]))
        proto.ended_at.CopyFrom(ts)
    if call.get("end_reason"):
        proto.end_reason = _CALL_END_REASON_STR_TO_PROTO.get(
            call["end_reason"], ProtoCallEndReason.CALL_END_REASON_UNSPECIFIED
        )
    return proto


_SENDER_TYPE_STR_TO_PROTO = {
    "USER": ProtoSenderType.SENDER_TYPE_USER,
    "AGENT": ProtoSenderType.SENDER_TYPE_AGENT,
    "SYSTEM": ProtoSenderType.SENDER_TYPE_SYSTEM,
    "GUEST": ProtoSenderType.SENDER_TYPE_GUEST,
}


def _build_message_proto(payload: dict) -> ProtoChatMessage:
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
        is_forwarded=payload.get("is_forwarded", False),
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

    # Copy metadata so agent kind dispatch works on the first MESSAGE_CREATED event.
    meta = payload.get("metadata")
    if isinstance(meta, dict):
        for k, v in meta.items():
            msg.metadata[str(k)] = v if isinstance(v, str) else dumps_str(v, default=str)

    raw_forward_context = payload.get("forward_context")
    if isinstance(raw_forward_context, dict):
        forward_context = forward_context_to_proto({
            ChatMessageMetadataKey.FORWARD.value: raw_forward_context
        })
        if forward_context is not None:
            msg.forward_context.CopyFrom(forward_context)

    return msg


def _payload_to_user_event(payload: dict) -> StreamUserChatEventsResponse | None:
    event_type = payload.get("_type")

    if event_type == evt.UNREAD_COUNT_CHANGED:
        return StreamUserChatEventsResponse(
            event_type=UserChatEventType.USER_CHAT_EVENT_TYPE_UNREAD_COUNT_CHANGED,
            timestamp=_now_ts(),
            unread_count=UnreadCountPayload(
                channel_id=payload.get("channel_id", ""),
                unread_count=payload.get("unread_count", 0),
                mention_count=payload.get("mention_count", 0),
                absolute=payload.get("absolute", False),
            ),
        )

    if event_type == evt.THREAD_ACTIVITY:
        event = StreamUserChatEventsResponse(
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
        return StreamUserChatEventsResponse(
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

    if event_type == evt.DRAFT_CHANGED:
        event = StreamUserChatEventsResponse(
            event_type=UserChatEventType.USER_CHAT_EVENT_TYPE_DRAFT_CHANGED,
            timestamp=_now_ts(),
            draft_changed=DraftChangedPayload(
                channel_id=payload.get("channel_id", ""),
                content=payload.get("content", ""),
                deleted=bool(payload.get("deleted", False)),
                client_session_id=payload.get("client_session_id", ""),
            ),
        )
        if payload.get("root_message_id"):
            event.draft_changed.root_message_id = payload["root_message_id"]
        if payload.get("updated_at"):
            ts = Timestamp()
            ts.FromDatetime(datetime.fromisoformat(payload["updated_at"]))
            event.draft_changed.updated_at.CopyFrom(ts)
        return event

    return None


_CHANNEL_EVENT_TYPES = {
    evt.MESSAGE_CREATED,
    evt.MESSAGE_UPDATED,
    evt.MESSAGE_DELETED,
    evt.REACTION_ADDED,
    evt.REACTION_REMOVED,
    evt.TYPING_STARTED,
    evt.MEMBER_JOINED,
    evt.MEMBER_LEFT,
    evt.MEMBER_UPDATED,
    evt.MEMBERS_ADDED,
    evt.MEMBERS_REMOVED,
    evt.CHANNEL_CREATED,
    evt.CHANNEL_UPDATED,
    evt.THREAD_UPDATED,
    evt.AGENT_TYPING,
    evt.AGENT_TOKEN_DELTA,
    evt.AGENT_THINKING_DELTA,
    evt.AGENT_TOOL_CALL,
    evt.AGENT_CONFIRMATION_REQUESTED,
    evt.AGENT_CONFIRMATION_RESOLVED,
    evt.CALL_STARTED,
    evt.CALL_ENDED,
    evt.CALL_PARTICIPANT_JOINED,
    evt.CALL_PARTICIPANT_LEFT,
    evt.CALL_PARTICIPANT_STATE,
    evt.CALL_RING,
    evt.CALL_HOST_CHANGED,
}


class ChatStreamHandlers:
    async def stream_user_chat_events(
        self,
        request: StreamUserChatEventsRequest,
        ctx: RequestContext,
    ) -> AsyncIterator[StreamUserChatEventsResponse]:
        """Subscribe to chat:user:{user_id}; channel events arrive via publisher fan-out."""
        user_id = current_user_id()

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
                            yield StreamUserChatEventsResponse(
                                event_type=UserChatEventType.USER_CHAT_EVENT_TYPE_HEARTBEAT,
                                timestamp=_now_ts(),
                            )
                            last_send = now
                        continue

                    event_type = payload.get("_type")

                    if event_type in _CHANNEL_EVENT_TYPES:
                        channel_event = _payload_to_channel_event(payload)
                        if channel_event:
                            yield StreamUserChatEventsResponse(
                                event_type=UserChatEventType.USER_CHAT_EVENT_TYPE_CHANNEL_EVENT,
                                timestamp=_now_ts(),
                                channel_event=channel_event,
                            )
                            last_send = now
                        continue

                    user_event = _payload_to_user_event(payload)
                    if user_event:
                        yield user_event
                        last_send = now

        except GeneratorExit:
            logger.info(
                f"unified chat stream generator closed for {user_id}",
                component=LOGGER_COMPONENT,
            )
