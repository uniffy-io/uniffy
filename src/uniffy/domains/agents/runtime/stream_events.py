"""Domain-level stream events for runtime (decoupled from proto)."""

from dataclasses import dataclass

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

    """

    text: str


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

    """

    tool_call_id: str
    tool_name: str
    tool_args: dict


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

    """

    tool_call_id: str
    tool_name: str
    success: bool
    result: str


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

    """

    tool_call_id: str
    tool_name: str
    tool_args: dict
    description: str


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
class RuntimeErrorEvent(RuntimeStreamEvent):
    """An error occurred during streaming.

    Attributes
    ----------
    error : str
        Error description.

    """

    error: str
