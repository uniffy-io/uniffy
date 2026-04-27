"""Polymorphic sender resolver for chat messages.

`chat_messages.sender_id` is a soft reference: when `sender_type=USER`
it points to `login_users.id`, when `sender_type=AGENT` it points to
`agents_agents.id` (see migration 047). This resolver hides the branch
from callers and, more importantly, collapses the per-message N+1 lookups
that used to sprinkle `select(User.full_name)` across streaming and
indexing code.

Typical usage from an RPC or background task:

    resolver = SenderResolver(session)
    info = await resolver.resolve_one(SenderType.USER, sender_id)
    bulk = await resolver.resolve_many([(t, i) for (t, i) in refs])

The resolver keeps a per-instance cache, so looking the same sender up
multiple times within a single request is free after the first hit.
"""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.chat.message import SenderType
from uniffy.core.models.login.user import User
from uniffy.core.users.cache import (
    get_cached_agent_profiles,
    get_cached_user_profiles,
    set_cached_agent_profile,
    set_cached_user_profile,
)


@dataclass(frozen=True, slots=True)
class SenderInfo:
    """Normalized display metadata for a USER or AGENT sender.

    `avatar_key` is an S3 key usable by the thumbnails/files HTTP routes.
    `avatar_emoji` is only populated for agents (users don't have emoji
    avatars). Callers that only care about a display string should use
    `display_name`.
    """

    id: UUID
    sender_type: SenderType
    display_name: str
    avatar_key: str | None = None
    avatar_emoji: str | None = None


_FALLBACK_NAME = "Unknown"


class SenderResolver:
    """Bulk polymorphic lookup with per-instance cache.

    Scoped to a single request / task. Cache is bounded by conversation
    size and cleared when the resolver is garbage-collected.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._cache: dict[tuple[SenderType, UUID], SenderInfo] = {}

    async def resolve_one(self, sender_type: SenderType, sender_id: UUID) -> SenderInfo:
        """Resolve a single sender; hits the cache after first lookup."""
        result = await self.resolve_many([(sender_type, sender_id)])
        return result.get(
            sender_id,
            SenderInfo(
                id=sender_id,
                sender_type=sender_type,
                display_name=_FALLBACK_NAME,
            ),
        )

    async def resolve_many(self, refs: list[tuple[SenderType, UUID]]) -> dict[UUID, SenderInfo]:
        """Resolve many senders in at most two queries (users + agents).

        Returns a dict keyed by sender id. Unknown / deleted refs are
        omitted; callers should fall back to `_FALLBACK_NAME`. Ambiguous
        duplicate ids across types are not expected (UUIDs are globally
        unique), so a single id in the return dict is fine.
        """
        missing_users: list[UUID] = []
        missing_agents: list[UUID] = []
        seen: set[tuple[SenderType, UUID]] = set()

        for sender_type, sender_id in refs:
            key = (sender_type, sender_id)
            if key in seen or key in self._cache:
                continue
            seen.add(key)
            if sender_type == SenderType.USER:
                missing_users.append(sender_id)
            elif sender_type == SenderType.AGENT:
                missing_agents.append(sender_id)

        # Try Valkey first; only the cache misses fall through to PG.
        if missing_users:
            cached_users, missing_users = await get_cached_user_profiles(
                missing_users
            )
            for uid, payload in cached_users.items():
                self._cache[(SenderType.USER, uid)] = SenderInfo(
                    id=uid,
                    sender_type=SenderType.USER,
                    display_name=payload.get("display_name") or _FALLBACK_NAME,
                    avatar_key=payload.get("avatar_key"),
                )

        if missing_agents:
            cached_agents, missing_agents = await get_cached_agent_profiles(
                missing_agents
            )
            for aid, payload in cached_agents.items():
                self._cache[(SenderType.AGENT, aid)] = SenderInfo(
                    id=aid,
                    sender_type=SenderType.AGENT,
                    display_name=payload.get("name") or _FALLBACK_NAME,
                    avatar_key=payload.get("avatar_key"),
                    avatar_emoji=payload.get("avatar_emoji") or None,
                )

        if missing_users:
            user_rows = await self._session.execute(
                select(
                    User.id,
                    User.full_name,
                    User.avatar_key,
                    User.username,
                ).where(User.id.in_(missing_users))
            )
            for row in user_rows.all():
                info = SenderInfo(
                    id=row[0],
                    sender_type=SenderType.USER,
                    display_name=row[1] or _FALLBACK_NAME,
                    avatar_key=row[2],
                )
                self._cache[(SenderType.USER, row[0])] = info
                await set_cached_user_profile(
                    row[0],
                    display_name=row[1] or _FALLBACK_NAME,
                    avatar_key=row[2],
                    username=row[3] or "",
                )

        if missing_agents:
            agent_rows = await self._session.execute(
                select(
                    Agent.id,
                    Agent.name,
                    Agent.avatar_key,
                    Agent.avatar_emoji,
                ).where(Agent.id.in_(missing_agents))
            )
            for row in agent_rows.all():
                info = SenderInfo(
                    id=row[0],
                    sender_type=SenderType.AGENT,
                    display_name=row[1] or _FALLBACK_NAME,
                    avatar_key=row[2],
                    avatar_emoji=row[3] or None,
                )
                self._cache[(SenderType.AGENT, row[0])] = info
                await set_cached_agent_profile(
                    row[0],
                    name=row[1] or _FALLBACK_NAME,
                    avatar_key=row[2],
                    avatar_emoji=row[3] or None,
                )

        out: dict[UUID, SenderInfo] = {}
        for sender_type, sender_id in refs:
            info = self._cache.get((sender_type, sender_id))
            if info is not None:
                out[sender_id] = info
        return out
