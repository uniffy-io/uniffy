"""Domain-level stream events for runtime (decoupled from proto)."""

from dataclasses import dataclass
from uuid import UUID

from uniffy.core.models.agents.message import AgentMessage


@dataclass
class RuntimeStreamEvent:
    """Base class for runtime stream events."""


@dataclass
class RuntimeTokenEvent(RuntimeStreamEvent):
    """A text token emitted during streaming.

    Attributes
    ----------
    text : str
        The token text.
    message_id : UUID | None
        Id of the placeholder chat row this token patches. Set on the
        chat-destination path so the translator can emit AGENT_TOKEN_DELTA
        keyed to the in-flight assistant message. `None` for
        session-backed streams that have no placeholder row.
    sequence : int
        Monotonic per-message counter starting at 1. Lets clients drop
        late deltas after a reorder. Always `0` when `message_id is None`.

    """

    text: str
    message_id: UUID | None = None
    sequence: int = 0


@dataclass
class RuntimeToolCallEvent(RuntimeStreamEvent):
    """A tool call requested by the LLM.

    Attributes
    ----------
    tool_call_id : str
        Tool call identifier.
    tool_name : str
        Tool function name.
    tool_args : dict
        Tool input arguments.
    message_id : UUID | None
        Id of the persisted message the writer created for this tool
        call. Required for the chat-destination translator; `None` for
        session-backed invocations.

    """

    tool_call_id: str
    tool_name: str
    tool_args: dict
    message_id: UUID | None = None


@dataclass
class RuntimeToolResultEvent(RuntimeStreamEvent):
    """Result of executing a tool call.

    Attributes
    ----------
    tool_call_id : str
        Tool call identifier.
    tool_name : str
        Tool function name.
    success : bool
        Whether the tool executed successfully.
    result : str
        Tool execution result or error message.
    message_id : UUID | None
        Id of the persisted tool-result message. `None` for session
        invocations.

    """

    tool_call_id: str
    tool_name: str
    success: bool
    result: str
    message_id: UUID | None = None


@dataclass
class RuntimeMessageStoredEvent(RuntimeStreamEvent):
    """A message was stored in the database.

    Attributes
    ----------
    message : AgentMessage
        The stored message.

    """

    message: AgentMessage


@dataclass
class RuntimeDoneEvent(RuntimeStreamEvent):
    """Streaming is complete with the final assistant response.

    Attributes
    ----------
    assistant_message : AgentMessage
        The final stored assistant message.
    model_used : str
        The model that generated the response.

    """

    assistant_message: AgentMessage
    model_used: str


@dataclass
class RuntimeConfirmationRequiredEvent(RuntimeStreamEvent):
    """A destructive tool requires user confirmation before execution.

    The streaming runtime pauses tool execution and waits for the
    user to approve or reject before proceeding.

    Attributes
    ----------
    tool_call_id : str
        Tool call identifier.
    tool_name : str
        Tool function name.
    tool_args : dict
        Tool input arguments.
    description : str
        Human-readable description of what will happen.
    request_id : UUID | None
        Opaque approval-store key; the chat translator publishes this
        so the RespondToAgentConfirmation RPC can match.
    message_id : UUID | None
        Id of the persisted confirmation-request message (chat
        destination only).

    """

    tool_call_id: str
    tool_name: str
    tool_args: dict
    description: str
    request_id: UUID | None = None
    message_id: UUID | None = None


@dataclass
class RuntimeConfirmationResponseEvent(RuntimeStreamEvent):
    """User's response to a confirmation request.

    Attributes
    ----------
    tool_call_id : str
        Tool call identifier.
    approved : bool
        Whether the user approved the action.

    """

    tool_call_id: str
    approved: bool


@dataclass
class RuntimeFailoverEvent(RuntimeStreamEvent):
    """The runtime swapped to a different provider key or model.

    Emitted at most ``MAX_FAILOVER_ATTEMPTS`` times per run, only
    after a retryable error on the previous candidate but before any
    token has been forwarded to the client. Purely informational --
    clients use it to surface "switched to X" notices.

    Attributes
    ----------
    from_provider_key_id : str
        Provider key id we just moved off (the one that failed). May
        be empty if the original run was driven by a non-key resolver.
    to_provider_key_id : str
        Provider key id we moved onto.
    to_model : str
        Model now in use (may be the same model on a different key,
        or a different fallback model entirely).
    reason : str
        Short reason classifier: "timeout" / "5xx" / "connection" /
        "other".
    attempt : int
        1-based attempt counter for the swap (first failover = 1).

    """

    from_provider_key_id: str
    to_provider_key_id: str
    to_model: str
    reason: str
    attempt: int


@dataclass
class RuntimeErrorEvent(RuntimeStreamEvent):
    """An error occurred during streaming.

    Attributes
    ----------
    error : str
        Error description.

    """

    error: str
