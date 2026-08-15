"""ARQ cron: flush dirty Valkey read cursors to PostgreSQL every 30s."""

import contextlib
from datetime import datetime
from typing import Any
from uuid import UUID

from loguru import logger

LOGGER_COMPONENT = "chat.read_state.flush"


async def flush_chat_read_cursors(ctx: dict[str, Any]) -> dict[str, Any]:
    from uniffy.core.valkey.ops import _get_ops_client

    client = _get_ops_client()
    if client is None:
        return {"status": "skipped", "reason": "valkey not available"}

    channel_count = await _flush_channel_cursors(client)
    thread_count = await _flush_thread_cursors(client)

    if channel_count > 0 or thread_count > 0:
        logger.info(
            f"Flushed {channel_count} channel + {thread_count} thread read cursors",
            component=LOGGER_COMPONENT,
        )

    return {
        "status": "ok",
        "channel_cursors": channel_count,
        "thread_cursors": thread_count,
    }


async def _flush_channel_cursors(client: Any) -> int:
    dirty_set_key = "chat:dirty_read_cursors"

    try:
        members = await client.smembers(dirty_set_key)
    except Exception:
        logger.warning("Failed to read dirty channel cursors set", component=LOGGER_COMPONENT)
        return 0

    if not members:
        return 0

    parsed: list[tuple[UUID, UUID, str]] = []  # (user_id, channel_id, valkey_key)
    for member in members:
        try:
            parts = str(member).split(":", 1)
            if len(parts) != 2:
                continue
            user_id = UUID(parts[0])
            channel_id = UUID(parts[1])
            key = f"chat:read:{user_id}:{channel_id}"
            parsed.append((user_id, channel_id, key))
        except ValueError, IndexError:
            continue

    if not parsed:
        return 0

    valkey_keys = [p[2] for p in parsed]
    try:
        values = await client.mget(*valkey_keys)
    except Exception:
        logger.warning("Failed to MGET channel cursors", component=LOGGER_COMPONENT)
        return 0

    rows_to_upsert = []
    for i, raw in enumerate(values):
        if not raw:
            continue
        try:
            val_parts = str(raw).split(":", 1)
            if len(val_parts) != 2:
                continue
            user_id, channel_id, _ = parsed[i]
            message_id = UUID(val_parts[0])
            read_at = datetime.fromisoformat(val_parts[1])
            rows_to_upsert.append({
                "channel_id": channel_id,
                "user_id": user_id,
                "last_read_message_id": message_id,
                "last_read_at": read_at,
            })
        except ValueError, IndexError:
            continue

    if not rows_to_upsert:
        with contextlib.suppress(Exception):
            await client.srem(dirty_set_key, *members)
        return 0

    from uniffy.db import open_session

    flushed = 0
    async with open_session() as session:
        try:
            from sqlalchemy.dialects.postgresql import insert

            from uniffy.core.models.chat.read_cursor import ChatReadCursor

            stmt = insert(ChatReadCursor).values(rows_to_upsert)
            stmt = stmt.on_conflict_do_update(
                index_elements=["channel_id", "user_id"],
                set_={
                    "last_read_message_id": stmt.excluded.last_read_message_id,
                    "last_read_at": stmt.excluded.last_read_at,
                },
            )
            await session.execute(stmt)
            await session.commit()
            flushed = len(rows_to_upsert)
        except Exception:
            logger.warning(
                "Failed to batch-upsert channel cursors",
                component=LOGGER_COMPONENT,
            )

    try:
        if members:
            await client.srem(dirty_set_key, *members)
    except Exception:
        logger.warning(
            "Failed to clean dirty channel cursors set",
            component=LOGGER_COMPONENT,
        )

    return flushed


async def _flush_thread_cursors(client: Any) -> int:
    dirty_set_key = "chat:dirty_thread_cursors"

    try:
        members = await client.smembers(dirty_set_key)
    except Exception:
        logger.warning("Failed to read dirty thread cursors set", component=LOGGER_COMPONENT)
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
        logger.warning("Failed to MGET thread cursors", component=LOGGER_COMPONENT)
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

    from uniffy.db import open_session

    flushed = 0
    async with open_session() as session:
        try:
            from sqlalchemy.dialects.postgresql import insert

            from uniffy.core.models.chat.read_cursor import ChatThreadReadCursor

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
                component=LOGGER_COMPONENT,
            )

    try:
        if members:
            await client.srem(dirty_set_key, *members)
    except Exception:
        logger.warning(
            "Failed to clean dirty thread cursors set",
            component=LOGGER_COMPONENT,
        )

    return flushed
