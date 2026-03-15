"""Core data classes for the agent tool system."""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession


@dataclass
class ToolContext:
    """Execution context passed to every tool executor.

    Attributes
    ----------
    session : AsyncSession
        Database session for queries and mutations.
    user_id : UUID
        The user on whose behalf the tool executes.
    organization_id : UUID
        Organization scope for multi-tenancy.
    agent_id : UUID | None
        The agent executing this tool (used by memory tools).
    session_id : UUID | None
        The session this tool execution belongs to (used for run logging).

    """

    session: AsyncSession
    user_id: UUID
    organization_id: UUID
    agent_id: UUID | None = None
    session_id: UUID | None = None
    user_timezone: str | None = None


@dataclass
class ToolResult:
    """Structured result from a tool execution.

    Attributes
    ----------
    success : bool
        Whether the tool executed successfully.
    data : str
        Serialized output for the LLM to read.
    error : str | None
        Error description when success is False.

    """

    success: bool
    data: str
    error: str | None = None


@dataclass(frozen=True)
class ToolDefinition:
    """A registered tool that agents can use.

    Attributes
    ----------
    name : str
        Unique tool identifier (e.g. "notes.search_notes").
    description : str
        Human-readable description shown to the LLM.
    parameter_schema : dict
        JSON Schema describing the tool's input parameters.
    executor : Callable
        Async function that performs the tool's action.
    destructive : bool
        Whether this tool performs destructive operations that
        require user confirmation before execution.

    """

    name: str
    description: str
    parameter_schema: dict = field(default_factory=dict)
    executor: Callable[[ToolContext, dict], Awaitable[ToolResult]] = field(
        default=None  # type: ignore[assignment]
    )
    destructive: bool = False
