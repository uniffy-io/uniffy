"""Runtime destinations: where a stream_send invocation writes its history."""

from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True, slots=True)
class SessionDestination:
    """Write to an `AgentSession` / `agents_messages`."""

    session_id: UUID


@dataclass(frozen=True, slots=True)
class ChatDestination:
    """Write to a `ChatChannel` / `chat_messages` as `sender_type=AGENT`."""

    channel_id: UUID
    agent_id: UUID
    trigger_message_id: UUID
    thread_root_id: UUID | None = None
    trigger_rule: str | None = None


RuntimeDestination = SessionDestination | ChatDestination
