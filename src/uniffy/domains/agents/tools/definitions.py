"""Core data classes for the agent tool system."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.search import SearchIndexer, WorkspaceSearch
from uniffy.core.storage import ObjectStorage

if TYPE_CHECKING:
    from uniffy.domains.agents.memories.scope import MemoryScopeRef
    from uniffy.domains.chat.lifecycle import ChannelCallLifecycle

CATEGORY_PLATFORM = "platform"
CATEGORY_EXTERNAL = "external"


@dataclass
class ToolContext:
    """Execution context passed to every tool executor."""

    session: AsyncSession
    user_id: UUID
    organization_id: UUID
    storage: ObjectStorage | None = None
    search_indexer: SearchIndexer | None = None
    call_lifecycle: ChannelCallLifecycle | None = None
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
    # True when query-conditioned recall promoted at least one entry onto the
    # trigger turn; memory.read uses the inverse to count recall misses that a
    # pull then recovered.
    memory_recall_promoted: bool = False
    # Side-channel for a write tool to surface runtime stream events (e.g. a
    # proposed skill draft) that the loop drains and forwards to the client.
    pending_events: list = field(default_factory=list)
    # Image-generation knobs the runtime resolved for this run (agent defaults
    # under any per-conversation override). The image tool merges the model's
    # own call args over these, then clamps the result to the org ceiling -
    # which is why the ceiling travels too.
    image_params: dict = field(default_factory=dict)
    image_max_resolution: str | None = None
    image_max_quality: str | None = None
    # The agent's provider -> connection pin map; the default connection for
    # integration tools when a call passes no `connection` argument.
    integration_connections: dict = field(default_factory=dict)
    # Chat destination of the run, when there is one. tools.load_group persists
    # its state on the (channel, agent) binding through this.
    channel_id: UUID | None = None
    # Deferred-advertisement state for this run: group label -> internal tool
    # names still loadable, plus the groups already advertised. Mutated by
    # tools.load_group; a load can only ever advertise from the agent's
    # enabled set, so this is routing state, not an authorization surface.
    deferred_tool_groups: dict = field(default_factory=dict)
    loaded_tool_groups: list = field(default_factory=list)
    # Every tool this run may execute, resolved from the agent's enabled set
    # after the image and integration filters. Deny by default: advertisement
    # is not authorization, and a model can name a tool it was never offered.
    allowed_tools: frozenset[str] = frozenset()

    @property
    def search(self) -> WorkspaceSearch:
        if self.search_indexer is None:
            raise RuntimeError("Search is required for workspace tools")
        return self.search_indexer.search

    @property
    def required_search(self) -> SearchIndexer:
        if self.search_indexer is None:
            raise RuntimeError("Search indexing is required for workspace mutations")
        return self.search_indexer

    @property
    def required_storage(self) -> ObjectStorage:
        if self.storage is None:
            raise RuntimeError("Object storage is required for workspace mutations")
        return self.storage

    @property
    def required_call_lifecycle(self) -> ChannelCallLifecycle:
        if self.call_lifecycle is None:
            raise RuntimeError("Call lifecycle is required for calendar attendee mutations")
        return self.call_lifecycle


@dataclass
class ToolResult:
    """Structured result from a tool execution.

    ``data`` is what the LLM reads. ``metadata`` is machine-readable detail the
    LLM never sees: it rides to the client on the tool-call row so a renderer
    can act on the result (the image card's regenerate menu needs the resolved
    params, which the model never chose).
    """

    success: bool
    data: str
    error: str | None = None
    metadata: dict | None = None


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
    display_name : str
        Label the builder UI and the tool-activity pane show. Falls back
        to a title-cased form of the name when empty.
    group : str
        Builder-UI grouping ("Notes", "GitHub", ...). Falls back to the
        name's prefix when empty.
    category : str
        ``platform`` for tools that run against this deployment, or
        ``external`` for tools that call a third-party API.
    internal : bool
        Framework plumbing (``skills.view_skill``): the runtime advertises
        it to the model on its own terms, so it is never offered as a
        builder-selectable capability.

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
    display_name: str = ""
    group: str = ""
    category: str = CATEGORY_PLATFORM
    internal: bool = False
