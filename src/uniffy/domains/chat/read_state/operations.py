"""Chat read state operations with Valkey-first write strategy.

Hot path: Valkey SET (sub-millisecond).
Cold path: PG fallback on cache miss.
Flush: ARQ cron every 30s batches dirty cursors to PG.
"""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.chat.read_cursor import ChatReadCursor, ChatThreadReadCursor

_EPOCH = datetime(1, 1, 1, tzinfo=UTC)

LOGGER_COMPONENT = "chat.read_state"

# Valkey key patterns
_CHANNEL_READ_KEY = "chat:read:{user_id}:{channel_id}"
_THREAD_READ_KEY = "chat:thread_read:{user_id}:{root_message_id}"
_DIRTY_CHANNEL_SET = "chat:dirty_read_cursors"
_DIRTY_THREAD_SET = "chat:dirty_thread_cursors"

# TTL for read cursor keys (7 days - refreshed on every write)
_READ_CURSOR_TTL = 7 * 24 * 3600


def _get_valkey_client():
    """Get the Valkey ops client used for cursor SET / dirty-set adds."""
    from uniffy.core.valkey.ops import _get_ops_client

    return _get_ops_client()


class ChatReadStateOperations:
    """Valkey-first read cursor management."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def mark_channel_read(
        self,
        user_id: UUID,
        channel_id: UUID,
        last_read_message_id: UUID,
    ) -> None:
        """Mark a channel as read up to a specific message.

        Writes to Valkey first (fast path), adds to dirty set for PG flush.
        Falls back to direct PG write if Valkey is unavailable.
        """
        now = datetime.now(UTC)
        value = f"{last_read_message_id}:{now.isoformat()}"
        key = _CHANNEL_READ_KEY.format(user_id=user_id, channel_id=channel_id)

        client = _get_valkey_client()
        if client is not None:
            try:
                await client.set(key, value, ex=_READ_CURSOR_TTL)
                await client.sadd(
                    _DIRTY_CHANNEL_SET,
                    f"{user_id}:{channel_id}",
                )
                return
            except Exception:
                logger.warning(
                    f"Valkey SET failed for {key}, falling back to PG",
                    component=LOGGER_COMPONENT,
                )

        # Fallback: write directly to PG
        await self._upsert_channel_cursor_pg(user_id, channel_id, last_read_message_id, now)

    async def mark_thread_read(
        self,
        user_id: UUID,
        root_message_id: UUID,
    ) -> None:
        """Mark a thread as read."""
        now = datetime.now(UTC)
        key = _THREAD_READ_KEY.format(user_id=user_id, root_message_id=root_message_id)

        client = _get_valkey_client()
        if client is not None:
            try:
                await client.set(key, now.isoformat(), ex=_READ_CURSOR_TTL)
                await client.sadd(
                    _DIRTY_THREAD_SET,
                    f"{user_id}:{root_message_id}",
                )
                return
            except Exception:
                logger.warning(
                    f"Valkey SET failed for {key}, falling back to PG",
                    component=LOGGER_COMPONENT,
                )

        # Fallback: write directly to PG
        await self._upsert_thread_cursor_pg(user_id, root_message_id, now)

    async def get_channel_read_cursor(
        self,
        user_id: UUID,
        channel_id: UUID,
    ) -> tuple[UUID | None, datetime | None]:
        """Get channel read cursor. Returns (last_read_message_id, last_read_at).

        Checks Valkey first, falls back to PG on miss.
        """
        key = _CHANNEL_READ_KEY.format(user_id=user_id, channel_id=channel_id)

        client = _get_valkey_client()
        if client is not None:
            try:
                raw = await client.get(key)
                if raw:
                    parts = raw.split(":", 1)
                    if len(parts) == 2:
                        return UUID(parts[0]), datetime.fromisoformat(parts[1])
            except Exception:
                pass

        # Cache miss - check PG
        result = await self.session.execute(
            select(
                ChatReadCursor.last_read_message_id,
                ChatReadCursor.last_read_at,
            ).where(
                ChatReadCursor.channel_id == channel_id,
                ChatReadCursor.user_id == user_id,
            )
        )
        row = result.one_or_none()
        if row:
            # Repopulate Valkey
            if client is not None and row[0]:
                try:
                    value = f"{row[0]}:{row[1].isoformat() if row[1] else ''}"
                    await client.set(key, value, ex=_READ_CURSOR_TTL)
                except Exception:
                    pass
            return row[0], row[1]

        return None, None

    async def get_unread_counts(
        self,
        user_id: UUID,
        channel_ids: list[UUID],
    ) -> dict[UUID, dict]:
        """Get unread counts for multiple channels in a single batch.

        Uses Valkey MGET for hot cursors, then a single SQL query for
        counting unread messages across all channels at once.

        Returns {channel_id: {unread_count, mention_count, last_read_message_id}}.
        """
        if not channel_ids:
            return {}

        # Phase 1: Batch-fetch read cursors from Valkey
        cursor_map: dict[UUID, tuple[UUID | None, datetime | None]] = {}
        valkey_miss_ids: list[UUID] = []

        client = _get_valkey_client()
        if client is not None:
            keys = [_CHANNEL_READ_KEY.format(user_id=user_id, channel_id=cid) for cid in channel_ids]
            try:
                values = await client.mget(*keys)
                for i, raw in enumerate(values):
                    cid = channel_ids[i]
                    if raw:
                        parts = str(raw).split(":", 1)
                        if len(parts) == 2:
                            cursor_map[cid] = (
                                UUID(parts[0]),
                                datetime.fromisoformat(parts[1]),
                            )
                            continue
                    valkey_miss_ids.append(cid)
            except Exception:
                valkey_miss_ids = list(channel_ids)
        else:
            valkey_miss_ids = list(channel_ids)

        # Phase 2: Fetch PG cursors for Valkey misses
        if valkey_miss_ids:
            pg_result = await self.session.execute(
                select(
                    ChatReadCursor.channel_id,
                    ChatReadCursor.last_read_message_id,
                    ChatReadCursor.last_read_at,
                ).where(
                    ChatReadCursor.user_id == user_id,
                    ChatReadCursor.channel_id.in_(valkey_miss_ids),
                )
            )
            for row in pg_result.all():
                cursor_map[row[0]] = (row[1], row[2])

            # Repopulate Valkey for PG hits
            if client is not None:
                for cid in valkey_miss_ids:
                    cur = cursor_map.get(cid)
                    if cur and cur[0]:
                        try:
                            key = _CHANNEL_READ_KEY.format(user_id=user_id, channel_id=cid)
                            value = f"{cur[0]}:{cur[1].isoformat() if cur[1] else ''}"
                            await client.set(key, value, ex=_READ_CURSOR_TTL)
                        except Exception:
                            pass

        # Phase 3: ONE query for unread + mention counts across every channel.
        #
        # Joins `chat_messages` against `unnest(channel_ids, last_read_ats)`
        # so each channel's per-user threshold is part of the same plan.
        # PG resolves the predicate `m.channel_id = c.channel_id AND
        # m.created_at > c.last_read_at` with a bitmap index scan over
        # `ix_chat_messages_channel_timeline`, plus the partial GIN
        # `ix_chat_messages_mentioned_urns` for the mention FILTER.
        # Channels with no read cursor get the epoch threshold so every
        # message qualifies as unread (cap of 100 still applies).
        user_mention_urn = f"urn:uniffy:content:USER:{user_id}"

        ordered_channel_ids: list[UUID] = list(channel_ids)
        last_read_ats: list[datetime] = []
        last_read_msg_ids: dict[UUID, UUID | None] = {}
        for cid in ordered_channel_ids:
            cur = cursor_map.get(cid)
            last_read_ats.append(cur[1] if cur and cur[1] is not None else _EPOCH)
            last_read_msg_ids[cid] = cur[0] if cur else None

        unread_query = text(
            """
            SELECT
                c.channel_id AS channel_id,
                LEAST(COUNT(*) FILTER (WHERE m.created_at > c.last_read_at), 100)
                    AS unread,
                COUNT(*) FILTER (
                    WHERE m.created_at > c.last_read_at
                      AND m.mentioned_urns @> ARRAY[:user_mention_urn]::text[]
                ) AS unread_mentions
            FROM unnest(
                CAST(:channel_ids AS UUID[]),
                CAST(:read_ats AS TIMESTAMP WITH TIME ZONE[])
            ) AS c(channel_id, last_read_at)
            JOIN chat_messages m ON c.channel_id = m.channel_id
            WHERE m.is_deleted = false AND m.root_id IS NULL
            GROUP BY c.channel_id
            """
        )

        result = await self.session.execute(
            unread_query,
            {
                "channel_ids": ordered_channel_ids,
                "read_ats": last_read_ats,
                "user_mention_urn": user_mention_urn,
            },
        )
        counts: dict[UUID, dict] = {}
        for row in result.all():
            cid = row[0] if isinstance(row[0], UUID) else UUID(str(row[0]))
            counts[cid] = {
                "unread_count": row[1],
                "mention_count": row[2],
                "last_read_message_id": last_read_msg_ids.get(cid),
            }

        # Channels with no rows in `chat_messages` (newly created or empty)
        # don't appear in the GROUP BY result; fill zeros so every requested
        # channel maps to a value.
        for cid in ordered_channel_ids:
            if cid not in counts:
                counts[cid] = {
                    "unread_count": 0,
                    "mention_count": 0,
                    "last_read_message_id": last_read_msg_ids.get(cid),
                }

        return counts

    async def batch_get_thread_read_cursors(
        self,
        user_id: UUID,
        root_message_ids: list[UUID],
    ) -> dict[UUID, datetime]:
        """Get thread read cursors for multiple threads. Returns {root_message_id: last_read_at}."""
        if not root_message_ids:
            return {}

        cursor_map: dict[UUID, datetime] = {}
        valkey_miss_ids: list[UUID] = []

        client = _get_valkey_client()
        if client is not None:
            keys = [
                _THREAD_READ_KEY.format(user_id=user_id, root_message_id=rid)
                for rid in root_message_ids
            ]
            try:
                values = await client.mget(*keys)
                for i, raw in enumerate(values):
                    rid = root_message_ids[i]
                    if raw:
                        try:
                            cursor_map[rid] = datetime.fromisoformat(str(raw))
                            continue
                        except (ValueError, TypeError):
                            pass
                    valkey_miss_ids.append(rid)
            except Exception:
                valkey_miss_ids = list(root_message_ids)
        else:
            valkey_miss_ids = list(root_message_ids)

        if valkey_miss_ids:
            pg_result = await self.session.execute(
                select(
                    ChatThreadReadCursor.root_message_id,
                    ChatThreadReadCursor.last_read_at,
                ).where(
                    ChatThreadReadCursor.user_id == user_id,
                    ChatThreadReadCursor.root_message_id.in_(valkey_miss_ids),
                )
            )
            for row in pg_result.all():
                cursor_map[row[0]] = row[1]

                if client is not None:
                    try:
                        key = _THREAD_READ_KEY.format(user_id=user_id, root_message_id=row[0])
                        await client.set(key, row[1].isoformat(), ex=_READ_CURSOR_TTL)
                    except Exception:
                        pass

        return cursor_map

    # Direct PG operations (used by flush job and fallback)

    async def _upsert_channel_cursor_pg(
        self,
        user_id: UUID,
        channel_id: UUID,
        last_read_message_id: UUID,
        last_read_at: datetime,
    ) -> None:
        """Upsert a channel read cursor directly to PG."""
        await self.session.execute(
            pg_insert(ChatReadCursor)
            .values(
                channel_id=channel_id,
                user_id=user_id,
                last_read_message_id=last_read_message_id,
                last_read_at=last_read_at,
            )
            .on_conflict_do_update(
                index_elements=["channel_id", "user_id"],
                set_={
                    "last_read_message_id": last_read_message_id,
                    "last_read_at": last_read_at,
                },
            )
        )
        await self.session.commit()

    async def _upsert_thread_cursor_pg(
        self,
        user_id: UUID,
        root_message_id: UUID,
        last_read_at: datetime,
    ) -> None:
        """Upsert a thread read cursor directly to PG."""
        await self.session.execute(
            pg_insert(ChatThreadReadCursor)
            .values(
                root_message_id=root_message_id,
                user_id=user_id,
                last_read_at=last_read_at,
                unread_mentions=0,
            )
            .on_conflict_do_update(
                index_elements=["root_message_id", "user_id"],
                set_={"last_read_at": last_read_at},
            )
        )
        await self.session.commit()
