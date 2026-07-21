"""Chat read state operations; Valkey-first writes, PG fallback, 30s ARQ flush cron."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.chat.read_cursor import ChatReadCursor, ChatThreadReadCursor

_EPOCH = datetime(1, 1, 1, tzinfo=UTC)

LOGGER_COMPONENT = "chat.read_state"

_CHANNEL_READ_KEY = "chat:read:{user_id}:{channel_id}"
_THREAD_READ_KEY = "chat:thread_read:{user_id}:{root_message_id}"
_DIRTY_CHANNEL_SET = "chat:dirty_read_cursors"
_DIRTY_THREAD_SET = "chat:dirty_thread_cursors"

# 7 days; refreshed on every write.
_READ_CURSOR_TTL = 7 * 24 * 3600


def _get_valkey_client():
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
        """Valkey SET then dirty-set add; falls back to direct PG upsert on Valkey outage."""
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

        await self._upsert_channel_cursor_pg(user_id, channel_id, last_read_message_id, now)

    async def mark_thread_read(
        self,
        user_id: UUID,
        root_message_id: UUID,
    ) -> None:
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

        await self._upsert_thread_cursor_pg(user_id, root_message_id, now)

    async def get_channel_read_cursor(
        self,
        user_id: UUID,
        channel_id: UUID,
    ) -> tuple[UUID | None, datetime | None]:
        """Returns (last_read_message_id, last_read_at); Valkey first, PG on miss."""
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
        """Batched unread counts; Valkey MGET cursors + one SQL aggregate per request."""
        if not channel_ids:
            return {}

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

        # One query: chat_messages joined with unnest(channel_ids, last_read_ats); mention
        # FILTER hits the partial GIN ix_chat_messages_mentioned_urns. No cursor -> epoch.
        user_mention_urn = f"urn:uniffy:content:USER:{user_id}"

        ordered_channel_ids: list[UUID] = list(channel_ids)
        last_read_ats: list[datetime] = []
        last_read_msg_ids: dict[UUID, UUID | None] = {}
        for cid in ordered_channel_ids:
            cur = cursor_map.get(cid)
            last_read_ats.append(cur[1] if cur and cur[1] is not None else _EPOCH)
            last_read_msg_ids[cid] = cur[0] if cur else None

        # Own messages never count as unread, regardless of cursor position -
        # another session of the same user must not see a badge for its own send.
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
              AND m.sender_id != :user_id
            GROUP BY c.channel_id
            """
        )

        result = await self.session.execute(
            unread_query,
            {
                "channel_ids": ordered_channel_ids,
                "read_ats": last_read_ats,
                "user_mention_urn": user_mention_urn,
                "user_id": user_id,
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

        # Empty channels don't appear in GROUP BY; fill zeros so every requested id maps.
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
        """Returns {root_message_id: last_read_at}; Valkey first, PG on miss."""
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

    async def _upsert_channel_cursor_pg(
        self,
        user_id: UUID,
        channel_id: UUID,
        last_read_message_id: UUID,
        last_read_at: datetime,
    ) -> None:
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
