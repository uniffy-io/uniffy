"""Core data classes for the agent tool system."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.search import SearchIndexer, WorkspaceSearch
from uniffy.core.storage import ObjectStorage
from uniffy.core.types import ContentType

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
    # Content revisions observed during this run. Isolated read-tool contexts
    # share the dict with sequential write tools, so a mutation can require a
    # fresh read instead of trusting a revision copied from conversation history.
    observed_content_versions: dict[tuple[ContentType, UUID], int] = field(default_factory=dict)

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
    """Tool output with model-visible data and client-only metadata."""

    success: bool
    data: str
    error: str | None = None
    metadata: dict | None = None


@dataclass(frozen=True)
class ToolDefinition:
    """Registration metadata and executor for one agent tool."""

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
