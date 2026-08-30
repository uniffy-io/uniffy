"""Memory context routing and prompt construction."""

from uuid import UUID

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.agents.memory import MemoryScope
from uniffy.core.models.chat.channel import ChannelType
from uniffy.domains.agents.cache import fetch_memory_index
from uniffy.domains.agents.memories.bridge import is_personal_bridge_enabled
from uniffy.domains.agents.memories.recall import (
    build_memory_recall,
    build_recall_query,
    render_recall_block,
)
from uniffy.domains.agents.memories.scope import MemoryScopeRef
from uniffy.domains.agents.runtime.destinations import (
    RuntimeDestination,
    SessionDestination,
)
from uniffy.domains.agents.runtime.prompt import MemoryScopeBlock, build_memory_block
from uniffy.domains.agents.runtime.settings.operations import get_runtime_settings
from uniffy.domains.chat.access import ChatAccessChecker

logger = logger.bind(component="agents.runtime.context.memory")

_SCOPE_LABELS = {
    MemoryScope.USER: (
        "Personal memory for this user (private to them; kept with every assistant they talk to)"
    ),
    MemoryScope.CHANNEL: "Channel memory (shared with all members of this channel)",
    MemoryScope.SESSION: "Session memory (shared with participants of this session)",
    MemoryScope.ORG: "Organization memory (curated by agent managers; visible to all members)",
}
_AGENT_ORG_LABEL = "Organization memory kept for you specifically (curated by agent managers)"
_BRIDGE_LABEL = (
    "Personal memory of the user who triggered this run (they opted in to "
    "using it in shared spaces; replies here are visible to others and may "
    "draw on it)"
)


class MemoryContextBuilder:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def resolve_scope(
        self,
        *,
        destination: RuntimeDestination,
        user_id: UUID,
        organization_id: UUID,
        session_kind: str | None = None,
    ) -> MemoryScopeRef:
        if isinstance(destination, SessionDestination):
            if session_kind in ("group", "global"):
                return MemoryScopeRef.session(destination.session_id)
            return MemoryScopeRef.user(user_id)

        channel = await ChatAccessChecker(self._session).get_channel(
            destination.channel_id,
            organization_id,
        )
        if (
            channel is not None
            and channel.is_agent_dm
            and channel.channel_type == ChannelType.DIRECT
        ):
            return MemoryScopeRef.user(user_id)
        return MemoryScopeRef.channel(destination.channel_id)

    async def resolve_bridge(
        self,
        *,
        scope_ref: MemoryScopeRef,
        user_id: UUID,
        organization_id: UUID,
    ) -> MemoryScopeRef | None:
        if scope_ref.scope not in (MemoryScope.CHANNEL, MemoryScope.SESSION):
            return None
        try:
            settings = await get_runtime_settings(self._session, organization_id)
            if not settings.personal_memory_bridge_enabled:
                return None
            if not await is_personal_bridge_enabled(
                self._session,
                user_id=user_id,
                organization_id=organization_id,
            ):
                return None
        except Exception:
            logger.opt(exception=True).warning("Memory bridge resolution failed")
            return None
        return MemoryScopeRef.user(user_id)

    async def build_context(
        self,
        *,
        agent_id: UUID,
        organization_id: UUID,
        scope_ref: MemoryScopeRef,
        bridge_ref: MemoryScopeRef | None = None,
    ) -> str | None:
        try:
            refs: list[tuple[MemoryScopeRef, str]] = [
                (MemoryScopeRef.org(), _SCOPE_LABELS[MemoryScope.ORG]),
                (MemoryScopeRef.org(agent_id), _AGENT_ORG_LABEL),
                (scope_ref, _SCOPE_LABELS[scope_ref.scope]),
            ]
            if bridge_ref is not None:
                refs.append((bridge_ref, _BRIDGE_LABEL))
            blocks: list[MemoryScopeBlock] = []
            for ref, label in refs:
                payload = await fetch_memory_index(
                    self._session,
                    organization_id=organization_id,
                    scope_ref=ref,
                )
                blocks.append(
                    MemoryScopeBlock(
                        label=label,
                        pinned=payload.get("pinned") or [],
                        index=payload.get("index") or [],
                        total=int(payload.get("total") or 0),
                    )
                )
            return build_memory_block(blocks)
        except Exception:
            logger.opt(exception=True).warning("Failed to build memory context")
            return None

    async def build_recall(
        self,
        *,
        agent_id: UUID,
        organization_id: UUID,
        scope_ref: MemoryScopeRef,
        context_messages: list,
        content: str,
    ) -> str | None:
        query = build_recall_query(context_messages, content)
        if not query:
            return None
        recall = await build_memory_recall(
            self._session,
            organization_id=organization_id,
            refs=[scope_ref, MemoryScopeRef.org(), MemoryScopeRef.org(agent_id)],
            query=query,
        )
        if recall is None:
            return None
        return render_recall_block(recall)
