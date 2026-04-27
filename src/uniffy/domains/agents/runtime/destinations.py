"""Runtime destinations: where a stream_send invocation writes its history.

Phase 2 decouples the streaming runtime from `AgentSession`. A destination
describes the persistent backing store the runtime will write into and read
context from. Two shapes exist today:

- `SessionDestination` - the legacy path, writing to `agents_messages` via
  `SessionOperations`. Powers the `/agents` builder Test tab.
- `ChatDestination` - chat-native path, writing to `chat_messages` with
  `sender_type=AGENT`. Powers the Phase 2 chat-triggered agents.

The runtime selects the matching `MessageWriter` from `writers.py` based on
the destination type. Tool-call approvals key on the destination's scope id
(session id for sessions, channel id for chat) so destructive-tool pauses
remain scoped to a single invocation surface.
"""

from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True, slots=True)
class SessionDestination:
    """Write to an `AgentSession` / `agents_messages`."""

    session_id: UUID


@dataclass(frozen=True, slots=True)
class ChatDestination:
    """Write to a `ChatChannel` / `chat_messages` as `sender_type=AGENT`.

    `trigger_message_id` is the user message that caused the invocation;
    it becomes `reply_to_id` on tool-call / final messages so the UI can
    thread the agent's response beneath the trigger.

    `thread_root_id` is set when the trigger is itself a thread reply
    (or when the trigger is a root message we want to thread the
    response under). The writer stamps `root_id` on every persisted
    agent message so the whole tool-call + tool-result + final
    sequence lands inside the same thread rather than the channel root.

    `trigger_rule` is the mention-detector rule that fired this invocation
    (``dm`` / ``mention`` / ``reply`` / ``thread``). Surfaced in the system
    prompt so the agent can orient itself when the same channel can invoke
    it through multiple paths.
    """

    channel_id: UUID
    agent_id: UUID
    trigger_message_id: UUID
    thread_root_id: UUID | None = None
    trigger_rule: str | None = None


RuntimeDestination = SessionDestination | ChatDestination
