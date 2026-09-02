"""Chat-domain Valkey cache helpers for channel metadata, member ids, DM
peers, pinned ids, and resources head.
"""

from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.cache.operations import (
    CACHE_MISS,
    cache_delete,
    cache_get,
    cache_get_many,
    cache_invalidate_many,
    cache_set,
)

logger = logger.bind(component="chat.cache")

_MEMBER_LIST_TTL_SECONDS = 300
_DM_PEERS_TTL_SECONDS = 3600
_PINNED_TTL_SECONDS = 3600
_RESOURCES_HEAD_TTL_SECONDS = 300

# Larger limits or offset > 0 fall through to PG; this is the autocomplete fast-path only.
RESOURCES_HEAD_LIMIT = 50

# Above this size, caching a member-id list costs more than the original PG SELECT.
MEMBER_LIST_CACHE_CAP = 5_000


def _members_key(channel_id: UUID) -> str:
    return f"chat:channel:{channel_id}:members"


def _dm_peers_key(channel_id: UUID) -> str:
    return f"chat:channel:{channel_id}:dm_peers"


def _pinned_key(channel_id: UUID) -> str:
    return f"chat:channel:{channel_id}:pinned"


def _resources_key(channel_id: UUID, content_type: str | None) -> str:
    bucket = (content_type or "all").upper()
    return f"chat:channel:{channel_id}:resources:{bucket}"


async def get_cached_member_ids(
    channel_id: UUID,
) -> list[dict[str, Any]] | None:
    cached = await cache_get(_members_key(channel_id))
    if cached is CACHE_MISS or cached is None:
        return None
    members = cached.get("members")
    if not isinstance(members, list):
        return None
    return members


async def set_cached_member_ids(
    channel_id: UUID,
    members: list[dict[str, Any]],
) -> None:
    """Cache a member-id payload; no-op when the list exceeds the cap."""
    if len(members) > MEMBER_LIST_CACHE_CAP:
        return
    await cache_set(
        _members_key(channel_id),
        {"members": members},
        ttl=_MEMBER_LIST_TTL_SECONDS,
    )


async def invalidate_cached_member_ids(channel_id: UUID) -> None:
    await cache_delete(_members_key(channel_id))


async def get_cached_dm_peers(channel_id: UUID) -> list[str] | None:
    cached = await cache_get(_dm_peers_key(channel_id))
    if cached is CACHE_MISS or cached is None:
        return None
    peers = cached.get("peers") if isinstance(cached, dict) else None
    if not isinstance(peers, list):
        return None
    return [str(p) for p in peers]


async def get_cached_dm_peers_many(
    channel_ids: list[UUID],
) -> tuple[dict[UUID, list[str]], list[UUID]]:
    """Bulk-read DM peer lists; misses preserve input order for a deterministic PG re-issue."""
    if not channel_ids:
        return {}, []
    keys = [_dm_peers_key(cid) for cid in channel_ids]
    hits, misses = await cache_get_many(keys)

    hit_map: dict[UUID, list[str]] = {}
    miss_cids: list[UUID] = []
    miss_set = set(misses)
    for key, cid in zip(keys, channel_ids, strict=True):
        if key in miss_set:
            miss_cids.append(cid)
            continue
        payload = hits.get(key)
        if payload is None:
            miss_cids.append(cid)
            continue
        peers = payload.get("peers") if isinstance(payload, dict) else None
        if not isinstance(peers, list):
            miss_cids.append(cid)
            continue
        hit_map[cid] = [str(p) for p in peers]

    return hit_map, miss_cids


async def set_cached_dm_peers(channel_id: UUID, peers: list[str]) -> None:
    # DM peer set is immutable post-create; only invalidation point is channel delete.
    await cache_set(
        _dm_peers_key(channel_id),
        {"peers": list(peers)},
        ttl=_DM_PEERS_TTL_SECONDS,
    )


async def invalidate_cached_dm_peers(channel_id: UUID) -> None:
    await cache_delete(_dm_peers_key(channel_id))


async def get_cached_pinned_message_ids(
    channel_id: UUID,
) -> list[UUID] | None:
    # Ids only; full message rows re-fetched from PG so edits propagate without invalidation.
    cached = await cache_get(_pinned_key(channel_id))
    if cached is CACHE_MISS or cached is None:
        return None
    ids = cached.get("ids") if isinstance(cached, dict) else None
    if not isinstance(ids, list):
        return None
    out: list[UUID] = []
    for raw in ids:
        try:
            out.append(UUID(str(raw)))
        except ValueError, AttributeError:
            continue
    return out


async def set_cached_pinned_message_ids(
    channel_id: UUID,
    message_ids: list[UUID],
) -> None:
    await cache_set(
        _pinned_key(channel_id),
        {"ids": [str(mid) for mid in message_ids]},
        ttl=_PINNED_TTL_SECONDS,
    )


async def invalidate_cached_pinned_messages(channel_id: UUID) -> None:
    await cache_delete(_pinned_key(channel_id))


async def get_cached_channel_resources_head(
    channel_id: UUID,
    content_type: str | None,
) -> tuple[list[dict[str, Any]], int] | None:
    """Cached (head, total); head is RESOURCES_HEAD_LIMIT rows ordered by last_mentioned_at desc."""
    cached = await cache_get(_resources_key(channel_id, content_type))
    if cached is CACHE_MISS or cached is None:
        return None
    resources = cached.get("resources") if isinstance(cached, dict) else None
    total = cached.get("total") if isinstance(cached, dict) else None
    if not isinstance(resources, list) or not isinstance(total, int):
        return None
    return resources, total


async def set_cached_channel_resources_head(
    channel_id: UUID,
    content_type: str | None,
    resources: list[dict[str, Any]],
    total: int,
) -> None:
    await cache_set(
        _resources_key(channel_id, content_type),
        {"resources": resources, "total": total},
        ttl=_RESOURCES_HEAD_TTL_SECONDS,
    )


async def invalidate_cached_channel_resources(
    channel_id: UUID,
    content_types: list[str] | None = None,
) -> None:
    """Drop the resources head; always wipes 'all', plus typed buckets in content_types."""
    keys = [_resources_key(channel_id, None)]
    seen: set[str] = set()
    for ct in content_types or []:
        ct_upper = ct.upper()
        if ct_upper in seen:
            continue
        seen.add(ct_upper)
        keys.append(_resources_key(channel_id, ct_upper))
    await cache_invalidate_many(*keys)


# One-shot warning dedup for oversize channels; set lives for process lifetime.
_warned_oversize: set[UUID] = set()


async def fetch_channel_members(
    session: AsyncSession,
    channel_id: UUID,
) -> list[dict[str, Any]]:
    """Cache-aware member-id fetch; oversize channels return uncached with a one-shot warning."""
    cached = await get_cached_member_ids(channel_id)
    if cached is not None:
        return cached

    from uniffy.core.models.chat.channel_member import ChatChannelMember

    try:
        result = await session.execute(
            select(
                ChatChannelMember.subject_type,
                ChatChannelMember.subject_id,
                ChatChannelMember.role,
                ChatChannelMember.user_id,
            ).where(ChatChannelMember.channel_id == channel_id)
        )
        rows = result.all()
    except Exception:
        logger.warning(
            f"Failed to fetch members for channel {channel_id}",
            component="chat-cache",
        )
        return []

    members: list[dict[str, Any]] = [
        {
            "subject_type": row[0].value if hasattr(row[0], "value") else row[0],
            "subject_id": str(row[1]),
            "role": row[2].value if hasattr(row[2], "value") else row[2],
            "user_id": str(row[3]) if row[3] else None,
        }
        for row in rows
    ]

    if len(members) > MEMBER_LIST_CACHE_CAP:
        if channel_id not in _warned_oversize:
            _warned_oversize.add(channel_id)
            logger.warning(
                f"Channel {channel_id} has {len(members)} members; "
                f"skipping member-id cache (cap {MEMBER_LIST_CACHE_CAP})",
                component="chat-cache",
            )
        return members

    await set_cached_member_ids(channel_id, members)
    return members
