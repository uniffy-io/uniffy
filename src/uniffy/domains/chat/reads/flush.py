"""ARQ cron: flush dirty Valkey read cursors to PostgreSQL every 30s."""

import contextlib
from datetime import UTC, datetime
from typing import Any, cast
from uuid import UUID

from loguru import logger
from sqlalchemy import Select, select, tuple_, update
from sqlalchemy.dialects.postgresql import insert
from valkey.asyncio import Redis

from uniffy.core.database import SESSION_FACTORY_CTX_KEY, SessionFactory
from uniffy.core.models.chat.read_cursor import ChatReadCursor, ChatThreadReadCursor
from uniffy.domains.chat.reads.cursors import (
    CURSOR_KEY,
    DIRTY_CURSORS,
    EPOCH,
    ChannelCursor,
    cache_cursor,
    clean_cursors,
    upsert_cursors,
)
from uniffy.infrastructure.valkey.ops import get_ops_client, ops_call

logger = logger.bind(component="chat.reads.flush")


def pending_cache_refresh() -> Select:
    # Written as the bare column: the partial index predicate is the bare
    # boolean, and PostgreSQL does not match it against `IS true`.
    return (
        select(ChatReadCursor)
        .where(ChatReadCursor.needs_cache_refresh)
        .order_by(ChatReadCursor.revision)
        .limit(500)
    )


async def reconcile_channel_cursors(client: Redis, session_factory: SessionFactory) -> int:
    repaired: list[tuple[UUID, UUID, UUID]] = []
    async with session_factory() as session:
        rows = (await session.execute(pending_cache_refresh())).scalars().all()
        for row in rows:
            cursor = ChannelCursor(
                row.revision,
                row.last_read_message_id,
                row.last_read_at.replace(tzinfo=UTC) if row.last_read_at else EPOCH,
            )
            try:
                await cache_cursor(client, row.user_id, row.channel_id, cursor)
            except Exception:
                logger.opt(exception=True).warning("Cursor cache reconciliation remains pending")
                break
            repaired.append((row.user_id, row.channel_id, cursor.revision))
        if repaired:
            await session.execute(
                update(ChatReadCursor)
                .where(
                    tuple_(
                        ChatReadCursor.user_id, ChatReadCursor.channel_id, ChatReadCursor.revision
                    ).in_(repaired),
                )
                .values(needs_cache_refresh=False)
            )
        await session.commit()
    return len(repaired)


async def flush_chat_read_cursors(ctx: dict[str, Any]) -> dict[str, Any]:
    client = get_ops_client()
    if client is None:
        return {"status": "skipped", "reason": "valkey not available"}

    session_factory = cast(SessionFactory, ctx[SESSION_FACTORY_CTX_KEY])
    try:
        await reconcile_channel_cursors(client, session_factory)
    except Exception:
        logger.opt(exception=True).warning("Failed to reconcile persisted channel cursors")
    channel_count = await _flush_channel_cursors(client, session_factory)
    thread_count = await _flush_thread_cursors(client, session_factory)

    if channel_count > 0 or thread_count > 0:
        logger.info(
            f"Flushed {channel_count} channel + {thread_count} thread read cursors",
        )

    return {
        "status": "ok",
        "channel_cursors": channel_count,
        "thread_cursors": thread_count,
    }


async def _flush_channel_cursors(client: Redis, session_factory: SessionFactory) -> int:
    try:
        async with ops_call("chat", "cursor_dirty"):
            members = await client.smembers(DIRTY_CURSORS)
    except Exception:
        logger.opt(exception=True).warning("Failed to read dirty channel cursors")
        return 0

    parsed: list[tuple[UUID, UUID, str, str]] = []
    for member in members:
        try:
            user, channel = member.split(":", 1)
            user_id, channel_id = UUID(user), UUID(channel)
            key = CURSOR_KEY.format(user_id=user_id, channel_id=channel_id)
            parsed.append((user_id, channel_id, key, member))
        except ValueError:
            continue
    if not parsed:
        return 0

    flushed = 0
    for offset in range(0, len(parsed), 500):
        batch = parsed[offset : offset + 500]
        try:
            async with ops_call("chat", "cursor_snapshot"):
                values = await client.mget(*(item[2] for item in batch))
        except Exception:
            logger.opt(exception=True).warning("Failed to snapshot channel cursors")
            return flushed

        rows = []
        snapshots = []
        for (user_id, channel_id, key, member), raw in zip(batch, values, strict=True):
            if raw:
                try:
                    cursor = ChannelCursor.decode(raw)
                except ValueError:
                    continue
                rows.append(cursor.row(user_id, channel_id))
            snapshots.append((key, raw or "", member))

        if rows:
            try:
                async with session_factory() as session:
                    await session.execute(upsert_cursors(rows))
                    await session.commit()
            except Exception:
                logger.opt(exception=True).warning("Failed to persist channel cursors")
                continue
            flushed += len(rows)
        try:
            await clean_cursors(client, snapshots)
        except Exception:
            logger.opt(exception=True).warning("Failed to clean dirty channel cursors")
    return flushed


async def _flush_thread_cursors(client: Any, session_factory: SessionFactory) -> int:
    dirty_set_key = "chat:dirty_thread_cursors"

    try:
        members = await client.smembers(dirty_set_key)
    except Exception:
        logger.warning("Failed to read dirty thread cursors set")
        return 0

    if not members:
        return 0

    parsed: list[tuple[UUID, UUID, str]] = []  # (user_id, root_message_id, valkey_key)
    for member in members:
        try:
            parts = str(member).split(":", 1)
            if len(parts) != 2:
                continue
            user_id = UUID(parts[0])
            root_message_id = UUID(parts[1])
            key = f"chat:thread_read:{user_id}:{root_message_id}"
            parsed.append((user_id, root_message_id, key))
        except ValueError, IndexError:
            continue

    if not parsed:
        return 0

    valkey_keys = [p[2] for p in parsed]
    try:
        values = await client.mget(*valkey_keys)
    except Exception:
        logger.warning("Failed to MGET thread cursors")
        return 0

    rows_to_upsert = []
    for i, raw in enumerate(values):
        if not raw:
            continue
        try:
            user_id, root_message_id, _ = parsed[i]
            read_at = datetime.fromisoformat(str(raw))
            rows_to_upsert.append({
                "root_message_id": root_message_id,
                "user_id": user_id,
                "last_read_at": read_at,
                "unread_mentions": 0,
            })
        except ValueError, IndexError:
            continue

    if not rows_to_upsert:
        with contextlib.suppress(Exception):
            await client.srem(dirty_set_key, *members)
        return 0

    flushed = 0
    async with session_factory() as session:
        try:
            stmt = insert(ChatThreadReadCursor).values(rows_to_upsert)
            stmt = stmt.on_conflict_do_update(
                index_elements=["root_message_id", "user_id"],
                set_={"last_read_at": stmt.excluded.last_read_at},
            )
            await session.execute(stmt)
            await session.commit()
            flushed = len(rows_to_upsert)
        except Exception:
            logger.warning(
                "Failed to batch-upsert thread cursors",
            )

    try:
        if members:
            await client.srem(dirty_set_key, *members)
    except Exception:
        logger.warning(
            "Failed to clean dirty thread cursors set",
        )

    return flushed
