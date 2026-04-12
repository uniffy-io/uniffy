"""Chat read state operations with Valkey-first write strategy.

Hot path: Valkey SET (sub-millisecond).
Cold path: PG fallback on cache miss.
Flush: ARQ cron every 30s batches dirty cursors to PG.
"""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.chat.message import ChatMessage
from uniffy.core.models.chat.read_cursor import ChatReadCursor, ChatThreadReadCursor

LOGGER_COMPONENT = "chat.read_state"

# Valkey key patterns
_CHANNEL_READ_KEY = "chat:read:{user_id}:{channel_id}"
_THREAD_READ_KEY = "chat:thread_read:{user_id}:{root_message_id}"
_DIRTY_CHANNEL_SET = "chat:dirty_read_cursors"
_DIRTY_THREAD_SET = "chat:dirty_thread_cursors"

# TTL for read cursor keys (7 days - refreshed on every write)
_READ_CURSOR_TTL = 7 * 24 * 3600


def _get_valkey_client():
    """Get the Valkey client (shared publisher connection)."""
    from uniffy.core.valkey.pubsub import _publisher

    return _publisher


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
        key = _CHANNEL_READ_KEY.format(
            user_id=user_id, channel_id=channel_id
        )

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
        await self._upsert_channel_cursor_pg(
            user_id, channel_id, last_read_message_id, now
        )

    async def mark_thread_read(
        self,
        user_id: UUID,
        root_message_id: UUID,
    ) -> None:
        """Mark a thread as read."""
        now = datetime.now(UTC)
        key = _THREAD_READ_KEY.format(
            user_id=user_id, root_message_id=root_message_id
        )

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
        key = _CHANNEL_READ_KEY.format(
            user_id=user_id, channel_id=channel_id
        )

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
            keys = [
                _CHANNEL_READ_KEY.format(user_id=user_id, channel_id=cid)
                for cid in channel_ids
            ]
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
                            key = _CHANNEL_READ_KEY.format(
                                user_id=user_id, channel_id=cid
                            )
                            value = f"{cur[0]}:{cur[1].isoformat() if cur[1] else ''}"
                            await client.set(key, value, ex=_READ_CURSOR_TTL)
                        except Exception:
                            pass

        # Phase 3: Single SQL query for unread counts across all channels
        # For channels with a cursor: count messages after the cursor timestamp
        # For channels without: count all root messages (capped at 100)
        counts: dict[UUID, dict] = {}

        # Channels with read cursors
        channels_with_cursor = {
            cid: cur for cid, cur in cursor_map.items() if cur[1] is not None
        }
        # Channels without read cursors
        channels_without_cursor = [
            cid for cid in channel_ids if cid not in channels_with_cursor
        ]

        # Query for channels without cursors (never read)
        if channels_without_cursor:
            result = await self.session.execute(
                select(
                    ChatMessage.channel_id,
                    func.least(func.count(), 100),
                )
                .where(
                    ChatMessage.channel_id.in_(channels_without_cursor),
                    ChatMessage.root_id.is_(None),
                    ChatMessage.is_deleted == False,  # noqa: E712
                )
                .group_by(ChatMessage.channel_id)
            )
            for row in result.all():
                counts[row[0]] = {
                    "unread_count": row[1],
                    "mention_count": 0,
                    "last_read_message_id": None,
                }
            # Fill zeros for channels with no messages
            for cid in channels_without_cursor:
                if cid not in counts:
                    counts[cid] = {
                        "unread_count": 0,
                        "mention_count": 0,
                        "last_read_message_id": None,
                    }

        # Query for channels with cursors (count messages after cursor timestamp)
        if channels_with_cursor:
            # Build a single query that counts per-channel with per-channel thresholds
            # Use a UNION ALL approach for different timestamps per channel
            from sqlalchemy import literal, union_all

            count_queries = []
            for cid, (_msg_id, read_at) in channels_with_cursor.items():
                q = (
                    select(
                        literal(str(cid)).label("channel_id"),
                        func.least(func.count(), 100).label("cnt"),
                    )
                    .where(
                        ChatMessage.channel_id == cid,
                        ChatMessage.root_id.is_(None),
                        ChatMessage.is_deleted == False,  # noqa: E712
                        ChatMessage.created_at > read_at,
                    )
                )
                count_queries.append(q)

            if count_queries:
                combined = union_all(*count_queries).subquery()
                result = await self.session.execute(
                    select(combined.c.channel_id, combined.c.cnt)
                )
                for row in result.all():
                    cid = UUID(row[0]) if isinstance(row[0], str) else row[0]
                    cursor_data = channels_with_cursor[cid]
                    counts[cid] = {
                        "unread_count": row[1],
                        "mention_count": 0,
                        "last_read_message_id": cursor_data[0],
                    }

            # Fill zeros for channels with cursor but no new messages
            for cid, (msg_id, _) in channels_with_cursor.items():
                if cid not in counts:
                    counts[cid] = {
                        "unread_count": 0,
                        "mention_count": 0,
                        "last_read_message_id": msg_id,
                    }

        return counts

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
