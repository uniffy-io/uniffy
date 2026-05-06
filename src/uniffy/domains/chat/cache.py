"""Chat-domain Valkey cache helpers.

Covers channel metadata, member-id lists, DM peer lists, pinned-message
ids, and the channel-resources autocomplete head. Each helper hides the
cache surface from operations: callers go through ``ChatAccessChecker``
for reads and through the explicit invalidation helpers below on writes.
Cache misses fall through to PG transparently; the non-fatal degradation
in ``core.valkey.cache`` covers Valkey outage.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.valkey.cache import (
    CACHE_MISS,
    cache_delete,
    cache_get,
    cache_get_many,
    cache_get_or_set_locked,
    cache_invalidate_many,
    cache_set,
)

_CHANNEL_TTL_SECONDS = 900
_MEMBER_LIST_TTL_SECONDS = 300
_DM_PEERS_TTL_SECONDS = 3600
_PINNED_TTL_SECONDS = 3600
_RESOURCES_HEAD_TTL_SECONDS = 300

# Fixed head size for the resources cache. Requests with a larger
# limit, or any offset > 0, fall through to PG. The cache is the
# autocomplete fast-path; deep paging is rare and not worth the sync
# complexity of caching arbitrary windows.
RESOURCES_HEAD_LIMIT = 50

# Cap above which we refuse to cache the member list. Reading 100KB of
# JSON to push it back through Valkey is more expensive than the original
# PG SELECT for very large channels; the cache is most valuable for the
# common <500-member case.
MEMBER_LIST_CACHE_CAP = 5_000


def _channel_key(channel_id: UUID) -> str:
    return f"chat:channel:{channel_id}"


def _members_key(channel_id: UUID) -> str:
    return f"chat:channel:{channel_id}:members"


def _dm_peers_key(channel_id: UUID) -> str:
    return f"chat:channel:{channel_id}:dm_peers"


def _pinned_key(channel_id: UUID) -> str:
    return f"chat:channel:{channel_id}:pinned"


def _resources_key(channel_id: UUID, content_type: str | None) -> str:
    bucket = (content_type or "all").upper()
    return f"chat:channel:{channel_id}:resources:{bucket}"


def _serialize_channel(channel: ChatChannel) -> dict[str, Any]:
    return {
        "id": str(channel.id),
        "organization_id": str(channel.organization_id),
        "owner_id": str(channel.owner_id),
        "name": channel.name,
        "slug": channel.slug,
        "description": channel.description,
        "channel_type": channel.channel_type.value,
        "is_encrypted": channel.is_encrypted,
        "is_archived": channel.is_archived,
        "is_default": channel.is_default,
        "is_deleted": channel.is_deleted,
        "icon": channel.icon,
        "category_id": str(channel.category_id) if channel.category_id else None,
        "is_agent_dm": channel.is_agent_dm,
        "custom_name": channel.custom_name,
        "agent_id": str(channel.agent_id) if channel.agent_id else None,
        "created_at": channel.created_at.isoformat() if channel.created_at else None,
        "updated_at": channel.updated_at.isoformat() if channel.updated_at else None,
        "deleted_at": channel.deleted_at.isoformat() if channel.deleted_at else None,
    }


def _deserialize_channel(payload: dict[str, Any]) -> ChatChannel:
    """Return a transient ChatChannel built from a cached payload.

    The instance is *not* attached to a session. Callers must not mutate
    or commit it - reads through ``ChatAccessChecker.get_channel`` are
    the only intended consumers, and they treat the row as read-only.
    """
    return ChatChannel(
        id=UUID(payload["id"]),
        organization_id=UUID(payload["organization_id"]),
        owner_id=UUID(payload["owner_id"]),
        name=payload["name"],
        slug=payload["slug"],
        description=payload["description"],
        channel_type=ChannelType(payload["channel_type"]),
        is_encrypted=payload["is_encrypted"],
        is_archived=payload["is_archived"],
        is_default=payload["is_default"],
        is_deleted=payload["is_deleted"],
        icon=payload["icon"],
        category_id=(
            UUID(payload["category_id"]) if payload.get("category_id") else None
        ),
        is_agent_dm=payload.get("is_agent_dm", False),
        custom_name=payload.get("custom_name"),
        agent_id=(
            UUID(payload["agent_id"]) if payload.get("agent_id") else None
        ),
        created_at=(
            datetime.fromisoformat(payload["created_at"])
            if payload.get("created_at")
            else None
        ),
        updated_at=(
            datetime.fromisoformat(payload["updated_at"])
            if payload.get("updated_at")
            else None
        ),
        deleted_at=(
            datetime.fromisoformat(payload["deleted_at"])
            if payload.get("deleted_at")
            else None
        ),
    )


async def get_cached_channel(channel_id: UUID) -> ChatChannel | None:
    """Return a transient ``ChatChannel`` from cache, or ``None`` on miss.

    A cached "doesn't exist" path is intentionally NOT supported - the
    PG ``select`` filters ``is_deleted = false``, and a brief delete
    window must not stick around as a sentinel.
    """
    cached = await cache_get(_channel_key(channel_id))
    if cached is CACHE_MISS or cached is None:
        return None
    return _deserialize_channel(cached)


async def set_cached_channel(channel: ChatChannel) -> None:
    if channel.is_deleted:
        # Don't seed the cache with a soft-deleted row; the read path
        # filters those out and a soft-deleted entry would be served as
        # though present.
        return
    await cache_set(
        _channel_key(channel.id),
        _serialize_channel(channel),
        ttl=_CHANNEL_TTL_SECONDS,
    )


async def invalidate_cached_channel(channel_id: UUID) -> None:
    await cache_delete(_channel_key(channel_id))


async def get_or_load_channel(
    session: AsyncSession,
    channel_id: UUID,
    organization_id: UUID,
) -> ChatChannel | None:
    """Stampede-protected cache-or-load for a channel row.

    On miss only one caller per pod runs the loader; losers wait on the
    short Valkey lock and re-read the cache. Soft-deleted rows are
    skipped (the loader filters them) so the cache is never seeded with
    a stale "deleted but visible" payload.
    """

    async def _load() -> dict[str, Any] | None:
        result = await session.execute(
            select(ChatChannel).where(
                ChatChannel.id == channel_id,
                ChatChannel.organization_id == organization_id,
                ChatChannel.is_deleted == False,  # noqa: E712
            )
        )
        row = result.scalar_one_or_none()
        return _serialize_channel(row) if row else None

    payload = await cache_get_or_set_locked(
        _channel_key(channel_id),
        _load,
        ttl=_CHANNEL_TTL_SECONDS,
    )
    if payload is None:
        return None
    channel = _deserialize_channel(payload)
    if channel.organization_id != organization_id:
        return None
    return channel


async def get_cached_member_ids(
    channel_id: UUID,
) -> list[dict[str, Any]] | None:
    """Return the cached member-id payload for a channel, or None."""
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
    """Cache a member-id payload. No-op when the list exceeds the cap."""
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
    """Return cached DM peer subject_ids for a channel, or ``None``."""
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
    """Bulk-read DM peer lists. Returns ``(hit_map, miss_channel_ids)``.

    Misses preserve input order so callers can re-issue the PG join
    deterministically.
    """
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
    """Cache the DM peer subject_id list for a channel.

    DM peer membership doesn't change after creation - rooms with a new
    set of peers are new rooms - so the only invalidation point is
    channel delete (handled in ``invalidate_cached_channel`` callers).
    """
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
    """Return cached pinned message ids (created_at desc), or ``None``.

    The cache stores ids only; full message rows are re-fetched from PG
    so message edits propagate without invalidation.
    """
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
        except (ValueError, AttributeError):
            continue
    return out


async def set_cached_pinned_message_ids(
    channel_id: UUID,
    message_ids: list[UUID],
) -> None:
    """Cache the ordered (created_at desc) pinned-message id list."""
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
    """Return cached `(resources_head, total)` or ``None`` on miss.

    The resources list is the first ``RESOURCES_HEAD_LIMIT`` rows
    ordered by ``last_mentioned_at`` desc. Callers slice the head to
    the requested limit.
    """
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
    """Cache the head-of-list resources payload for a channel + filter."""
    await cache_set(
        _resources_key(channel_id, content_type),
        {"resources": resources, "total": total},
        ttl=_RESOURCES_HEAD_TTL_SECONDS,
    )


async def invalidate_cached_channel_resources(
    channel_id: UUID,
    content_types: list[str] | None = None,
) -> None:
    """Drop the resources head cache for a channel.

    Always wipes the ``all`` bucket. ``content_types`` specifies which
    typed buckets to additionally drop - typically the unique types
    touched by an upsert/decrement so unaffected buckets stay warm.
    """
    keys = [_resources_key(channel_id, None)]
    seen: set[str] = set()
    for ct in content_types or []:
        ct_upper = ct.upper()
        if ct_upper in seen:
            continue
        seen.add(ct_upper)
        keys.append(_resources_key(channel_id, ct_upper))
    await cache_invalidate_many(*keys)


# One-shot warning dedup for channels above the cache cap. Set lives for
# the process lifetime - a channel that grows past the cap once will only
# log on the first miss after restart, which is the right cadence.
_warned_oversize: set[UUID] = set()


async def fetch_channel_members(
    session: AsyncSession,
    channel_id: UUID,
) -> list[dict[str, Any]]:
    """Cache-aware polymorphic member-id fetch for a channel.

    Returns the full ``[{subject_type, subject_id, role, user_id}, ...]``
    list. Callers project as needed (the send pipeline filters
    ``subject_type == "USER"`` and drops ``None`` user_ids).

    Behaviour:
    - Cache hit: return the cached list directly.
    - Cache miss: PG SELECT, cache the result, return.
    - Oversize miss (>``MEMBER_LIST_CACHE_CAP``): return uncached and
      emit a one-shot warning per channel id; subsequent misses on the
      same channel skip the log to avoid spam under load.

    Stampede protection is intentionally NOT layered here. The
    oversize-cap branch is incompatible with ``cache_get_or_set_locked``
    (which always caches the loader's return value), and the
    small-channel happy path is fast enough that a herd is bearable.
    Worth revisiting if a future channel grows past the cap and load
    tests show stampede behaviour.
    """
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
