"""Cached channel and thread read positions."""

from contextlib import suppress
from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import select, text, tuple_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from valkey.asyncio import Redis

from uniffy.core.content.references import BROADCAST_URNS
from uniffy.core.errors import NotFoundError
from uniffy.core.models.chat.message import ChatMessage
from uniffy.core.models.chat.read_cursor import ChatReadCursor, ChatThreadReadCursor
from uniffy.core.types import generate_id
from uniffy.domains.chat.reads.cursors import (
    CURSOR_KEY,
    EPOCH,
    ChannelCursor,
    cache_cursor,
    upsert_cursors,
    warm_cursor,
)
from uniffy.domains.directory.membership import user_team_ids
from uniffy.infrastructure.valkey.ops import get_ops_client, ops_call

_EPOCH = EPOCH

logger = logger.bind(component="chat.reads")

_THREAD_READ_KEY = "chat:thread_read:{user_id}:{root_message_id}"
_DIRTY_THREAD_SET = "chat:dirty_thread_cursors"

# 7 days; refreshed on every write.
_READ_CURSOR_TTL = 7 * 24 * 3600


def _get_valkey_client() -> Redis | None:
    return get_ops_client()


class ChatReadStateOperations:
    """Valkey-first read cursor management."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self._fallback_cursors: dict[tuple[UUID, UUID], ChannelCursor] = {}

    async def mark_channel_read(
        self,
        user_id: UUID,
        channel_id: UUID,
        last_read_message_id: UUID,
    ) -> None:
        cursor = ChannelCursor(generate_id(), last_read_message_id, datetime.now(UTC))
        await self._write_channel_cursor(user_id, channel_id, cursor)

    async def mark_channel_unread(
        self,
        user_id: UUID,
        channel_id: UUID,
        message_id: UUID,
    ) -> tuple[UUID | None, datetime]:
        revision = generate_id()
        predecessor = await self._preceding_message(channel_id, message_id)
        cursor_id, cursor_at = predecessor if predecessor else (None, _EPOCH)
        await self._write_channel_cursor(
            user_id,
            channel_id,
            ChannelCursor(revision, cursor_id, cursor_at),
        )
        return cursor_id, cursor_at

    async def _write_channel_cursor(
        self,
        user_id: UUID,
        channel_id: UUID,
        cursor: ChannelCursor,
    ) -> None:
        client = _get_valkey_client()
        if client is not None:
            try:
                await cache_cursor(client, user_id, channel_id, cursor)
                return
            except Exception:
                logger.opt(exception=True).warning("Cursor cache write failed; persisting directly")
        row = cursor.row(user_id, channel_id)
        row["needs_cache_refresh"] = True
        await self.session.execute(upsert_cursors([row]))
        await self.session.commit()
        stored = (
            await self.session.execute(
                select(ChatReadCursor)
                .where(
                    ChatReadCursor.user_id == user_id,
                    ChatReadCursor.channel_id == channel_id,
                )
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        self._fallback_cursors[user_id, channel_id] = ChannelCursor(
            stored.revision,
            stored.last_read_message_id,
            stored.last_read_at.replace(tzinfo=UTC) if stored.last_read_at else _EPOCH,
        )

    async def _preceding_message(
        self,
        channel_id: UUID,
        message_id: UUID,
    ) -> tuple[UUID, datetime] | None:
        target = (
            await self.session.execute(
                select(ChatMessage.created_at).where(
                    ChatMessage.id == message_id,
                    ChatMessage.channel_id == channel_id,
                    ChatMessage.is_deleted.is_(False),
                    ChatMessage.root_id.is_(None),
                )
            )
        ).one_or_none()
        if target is None:
            raise NotFoundError("message", str(message_id))

        # (created_at, id) is the same total order the message list pages on, so a
        # shared created_at cannot make the cursor straddle two rows.
        result = await self.session.execute(
            select(ChatMessage.id, ChatMessage.created_at)
            .where(
                ChatMessage.channel_id == channel_id,
                ChatMessage.is_deleted.is_(False),
                ChatMessage.root_id.is_(None),
                tuple_(ChatMessage.created_at, ChatMessage.id) < tuple_(target[0], message_id),
            )
            .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
            .limit(1)
        )
        row = result.one_or_none()
        return (row[0], row[1]) if row else None

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
                )

        await self._upsert_thread_cursor_pg(user_id, root_message_id, now)

    async def get_channel_read_cursor(
        self,
        user_id: UUID,
        channel_id: UUID,
    ) -> tuple[UUID | None, datetime | None]:
        cursor = (await self._channel_cursors(user_id, [channel_id])).get(channel_id)
        return (cursor.message_id, cursor.read_at) if cursor else (None, None)

    async def _channel_cursors(
        self,
        user_id: UUID,
        channel_ids: list[UUID],
    ) -> dict[UUID, ChannelCursor]:
        cursors: dict[UUID, ChannelCursor] = {}
        client = _get_valkey_client()
        if client is not None:
            keys = [CURSOR_KEY.format(user_id=user_id, channel_id=cid) for cid in channel_ids]
            try:
                async with ops_call("chat", "cursor_read"):
                    values = await client.mget(*keys)
                for cid, raw in zip(channel_ids, values, strict=True):
                    if raw:
                        with suppress(ValueError):
                            cursors[cid] = ChannelCursor.decode(raw)
            except Exception:
                logger.opt(exception=True).warning("Cursor cache read failed")

        missing = [cid for cid in channel_ids if cid not in cursors]
        if missing:
            result = await self.session.execute(
                select(
                    ChatReadCursor.channel_id,
                    ChatReadCursor.last_read_message_id,
                    ChatReadCursor.last_read_at,
                    ChatReadCursor.revision,
                ).where(
                    ChatReadCursor.user_id == user_id,
                    ChatReadCursor.channel_id.in_(missing),
                )
            )
            for cid, message_id, read_at, revision in result.all():
                # asyncpg decodes PostgreSQL negative infinity as a naive datetime.min.
                cursor = ChannelCursor(
                    revision, message_id, read_at.replace(tzinfo=UTC) if read_at else _EPOCH
                )
                cursors[cid] = cursor
                if client is not None:
                    try:
                        await warm_cursor(client, user_id, cid, cursor)
                    except Exception:
                        logger.opt(exception=True).warning("Cursor cache warm failed")
        for cid in channel_ids:
            fallback = self._fallback_cursors.get((user_id, cid))
            if fallback is not None and (
                cid not in cursors or cursors[cid].revision < fallback.revision
            ):
                cursors[cid] = fallback
        return cursors

    async def get_unread_counts(
        self,
        user_id: UUID,
        organization_id: UUID,
        channel_ids: list[UUID],
    ) -> dict[UUID, dict]:
        if not channel_ids:
            return {}
        cursor_map = await self._channel_cursors(user_id, channel_ids)

        # One query: chat_messages joined with unnest(channel_ids, last_read_ats); mention
        # FILTER hits the partial GIN ix_chat_messages_mentioned_urns. No cursor -> epoch.
        # Team mentions are matched at read time, so joining or leaving a team
        # moves the badge for history the user already has. SYSTEM rows are
        # excluded from the mention count only: the urn in "X added Y to the
        # channel" is copy, not a ping, but the row is still unread.
        # Broadcast mentions (@channel/@here) badge every member,
        # @here included: presence only narrowed who was *notified* at send.
        mention_urns = [f"urn:uniffy:content:USER:{user_id}", *BROADCAST_URNS]
        mention_urns += [
            f"urn:uniffy:content:TEAM:{team_id}"
            for team_id in await user_team_ids(self.session, organization_id, user_id)
        ]

        ordered_channel_ids: list[UUID] = list(channel_ids)
        last_read_ats: list[datetime] = []
        last_read_msg_ids: dict[UUID, UUID | None] = {}
        for cid in ordered_channel_ids:
            cur = cursor_map.get(cid)
            last_read_ats.append(cur.read_at if cur else _EPOCH)
            last_read_msg_ids[cid] = cur.message_id if cur else None

        # Own messages never count as unread, regardless of cursor position -
        # another session of the same user must not see a badge for its own send.
        unread_query = text(
            """
            SELECT
                c.channel_id AS channel_id,
                LEAST(COUNT(*), 100)
                    AS unread,
                COUNT(*) FILTER (
                    WHERE m.sender_type <> 'SYSTEM'
                      AND m.mentioned_urns && CAST(:mention_urns AS text[])
                ) AS unread_mentions
            FROM unnest(
                CAST(:channel_ids AS UUID[]),
                CAST(:read_ats AS TIMESTAMP WITH TIME ZONE[]),
                CAST(:read_ids AS UUID[])
            ) AS c(channel_id, last_read_at, last_read_message_id)
            JOIN chat_messages m ON c.channel_id = m.channel_id
            WHERE m.is_deleted = false AND m.root_id IS NULL
              AND m.sender_id != :user_id
              AND (m.created_at, m.id) > (c.last_read_at, c.last_read_message_id)
            GROUP BY c.channel_id
            """
        )

        result = await self.session.execute(
            unread_query,
            {
                "channel_ids": ordered_channel_ids,
                "read_ats": last_read_ats,
                "read_ids": [last_read_msg_ids[cid] or UUID(int=0) for cid in ordered_channel_ids],
                "mention_urns": mention_urns,
                "user_id": user_id,
            },
        )
        latest_ids = await self._latest_message_ids(ordered_channel_ids)
        first_ids = await self._first_unread_ids(user_id, ordered_channel_ids, cursor_map)

        counts: dict[UUID, dict] = {}
        for row in result.all():
            cid = row[0] if isinstance(row[0], UUID) else UUID(str(row[0]))
            counts[cid] = {
                "unread_count": row[1],
                "mention_count": row[2],
                "last_read_message_id": last_read_msg_ids.get(cid),
                "latest_message_id": latest_ids.get(cid),
                "first_unread_message_id": first_ids.get(cid),
            }

        # Empty channels don't appear in GROUP BY; fill zeros so every requested id maps.
        for cid in ordered_channel_ids:
            if cid not in counts:
                counts[cid] = {
                    "unread_count": 0,
                    "mention_count": 0,
                    "last_read_message_id": last_read_msg_ids.get(cid),
                    "latest_message_id": latest_ids.get(cid),
                    "first_unread_message_id": first_ids.get(cid),
                }

        return counts

    async def _first_unread_ids(
        self,
        user_id: UUID,
        channel_ids: list[UUID],
        cursors: dict[UUID, ChannelCursor],
    ) -> dict[UUID, UUID]:
        result = await self.session.execute(
            text("""
                SELECT c.channel_id, first.id
                FROM unnest(
                    CAST(:channel_ids AS UUID[]),
                    CAST(:read_ats AS TIMESTAMP WITH TIME ZONE[]),
                    CAST(:read_ids AS UUID[])
                ) AS c(channel_id, read_at, message_id)
                CROSS JOIN LATERAL (
                    SELECT m.id FROM chat_messages m
                    WHERE m.channel_id = c.channel_id
                      AND m.is_deleted = false AND m.root_id IS NULL
                      AND m.sender_id != :user_id
                      AND (m.created_at, m.id) > (c.read_at, c.message_id)
                    ORDER BY m.created_at, m.id
                    LIMIT 1
                ) first
            """),
            {
                "channel_ids": channel_ids,
                "read_ats": [
                    cursors[cid].read_at if cid in cursors else _EPOCH for cid in channel_ids
                ],
                "read_ids": [
                    (cursors[cid].message_id if cid in cursors else None) or UUID(int=0)
                    for cid in channel_ids
                ],
                "user_id": user_id,
            },
        )
        return {row[0]: row[1] for row in result.all()}

    async def _latest_message_ids(self, channel_ids: list[UUID]) -> dict[UUID, UUID]:
        """Newest root message per channel, one batched backward scan of the roots index."""
        if not channel_ids:
            return {}

        result = await self.session.execute(
            text(
                """
                SELECT DISTINCT ON (m.channel_id) m.channel_id, m.id
                FROM chat_messages m
                WHERE m.channel_id = ANY(CAST(:channel_ids AS UUID[]))
                  AND m.is_deleted = false AND m.root_id IS NULL
                ORDER BY m.channel_id, m.created_at DESC, m.id DESC
                """
            ),
            {"channel_ids": channel_ids},
        )
        latest: dict[UUID, UUID] = {}
        for row in result.all():
            cid = row[0] if isinstance(row[0], UUID) else UUID(str(row[0]))
            latest[cid] = row[1] if isinstance(row[1], UUID) else UUID(str(row[1]))
        return latest

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
                        except ValueError, TypeError:
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
