"""Core data classes for the agent tool system."""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

if TYPE_CHECKING:
    from uniffy.domains.agents.memories.scope import MemoryScopeRef


@dataclass
class ToolContext:
    """Execution context passed to every tool executor."""

    session: AsyncSession
    user_id: UUID
    organization_id: UUID
    agent_id: UUID | None = None
    session_id: UUID | None = None
    user_timezone: str | None = None
    # True when the run belongs to a test-drawer session: memory write tools
    # return a structured error instead of persisting anything.
    is_test_session: bool = False
    # Audience scope the runtime resolved for this run; memory tools refuse
    # to operate without it (no silent fallback to personal scope).
    memory_scope: MemoryScopeRef | None = None
    # Opted-in personal scope, READ-only widening for shared-space runs;
    # write tools must never target it.
    memory_bridge_scope: MemoryScopeRef | None = None
    # Side-channel for a write tool to surface runtime stream events (e.g. a
    # proposed skill draft) that the loop drains and forwards to the client.
    pending_events: list = field(default_factory=list)


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
    read_only : bool
        Whether the tool only reads data. Read-only tools may run
        concurrently within the same assistant turn against private
        per-tool sessions; write tools always run sequentially against
        the runtime's own session so transaction boundaries hold.
    timeout_seconds : int
        Per-tool wall-clock cap. ``ToolExecutor.execute`` wraps the
        executor in ``asyncio.wait_for(..., timeout=timeout_seconds)``
        and returns a structured timeout failure when the ceiling is
        exceeded.

    """

    name: str
    description: str
    parameter_schema: dict = field(default_factory=dict)
    executor: Callable[[ToolContext, dict], Awaitable[ToolResult]] = field(
        default=None  # type: ignore[assignment]
    )
    destructive: bool = False
    read_only: bool = False
    timeout_seconds: int = 15
