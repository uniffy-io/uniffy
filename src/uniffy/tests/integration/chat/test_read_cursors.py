"""Exercise cursor ordering against PostgreSQL and Valkey."""

import asyncio
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from valkey.asyncio import Redis

from uniffy.core.types import generate_id
from uniffy.domains.chat.reads import cursors, flush, operations
from uniffy.domains.chat.reads.cursors import (
    CURSOR_KEY,
    EPOCH,
    ChannelCursor,
    cache_cursor,
    clean_cursors,
    upsert_cursors,
    warm_cursor,
)
from uniffy.domains.chat.reads.operations import ChatReadStateOperations
from uniffy.infrastructure.database.session import get_database_url
from uniffy.infrastructure.valkey.config import ValkeyConfig

pytestmark = pytest.mark.asyncio(loop_scope="session")
AT = datetime(2026, 9, 14, 10, tzinfo=UTC)


@pytest_asyncio.fixture(loop_scope="session")
async def cursor_db():
    engine = create_async_engine(get_database_url())
    try:
        async with engine.connect() as connection:
            await connection.execute(
                text(
                    "CREATE TEMP TABLE chat_read_cursors "
                    "(LIKE public.chat_read_cursors INCLUDING ALL)"
                )
            )
            await connection.execute(
                text(
                    "CREATE TEMP TABLE chat_messages (id uuid, channel_id uuid, "
                    "created_at timestamptz, is_deleted boolean, root_id uuid, sender_id uuid, "
                    "sender_type text, mentioned_urns text[])"
                )
            )
            await connection.commit()
            yield connection
    finally:
        await engine.dispose()


@pytest_asyncio.fixture(loop_scope="session")
async def cursor_cache(monkeypatch):
    config = ValkeyConfig.from_env()
    client = Redis.from_url(config.to_url(), **config.to_ops_kwargs())
    dirty = f"chat:test_dirty_cursors:{generate_id()}"
    monkeypatch.setattr(cursors, "DIRTY_CURSORS", dirty)
    monkeypatch.setattr(flush, "DIRTY_CURSORS", dirty)
    monkeypatch.setattr(operations, "_get_valkey_client", lambda: client)
    keys = []

    def key(user, channel):
        value = CURSOR_KEY.format(user_id=user, channel_id=channel)
        keys.append(value)
        return value

    try:
        yield client, dirty, key
    finally:
        await client.delete(dirty, *keys)
        await client.aclose()


async def test_rewind_counts_timestamp_ties_and_skips_own_deleted_and_replies(
    cursor_db,
    cursor_cache,
    monkeypatch,
):
    client, _, key = cursor_cache
    user, sender, channel, org = [generate_id() for _ in range(4)]
    ids = sorted(generate_id() for _ in range(6))
    key(user, channel)
    async with AsyncSession(bind=cursor_db) as session:
        for index, message_id in enumerate(ids):
            await session.execute(
                text(
                    "INSERT INTO chat_messages VALUES "
                    "(:id, :channel, :at, :deleted, :root, :sender, 'USER', :mentions)"
                ),
                {
                    "id": message_id,
                    "channel": channel,
                    "at": AT,
                    "deleted": index == 2,
                    "root": ids[0] if index == 3 else None,
                    "sender": user if index == 4 else sender,
                    "mentions": [f"urn:uniffy:content:USER:{user}"],
                },
            )
        ops = ChatReadStateOperations(session)
        monkeypatch.setattr(operations, "user_team_ids", AsyncMock(return_value=[]))
        await ops.mark_channel_unread(user, channel, ids[1])
        result = (await ops.get_unread_counts(user, org, [channel]))[channel]
        assert result["last_read_message_id"] == ids[0]
        assert result["unread_count"] == 2
        assert result["mention_count"] == 2
        assert result["first_unread_message_id"] == ids[1]
        await ops.mark_channel_unread(user, channel, ids[0])
        result = (await ops.get_unread_counts(user, org, [channel]))[channel]
        assert result["last_read_message_id"] is None
        assert result["unread_count"] == 3
        assert result["first_unread_message_id"] == ids[0]


async def test_first_unread_remains_exact_beyond_badge_cap(cursor_db, cursor_cache, monkeypatch):
    _, _, key = cursor_cache
    user, sender, channel, org = [generate_id() for _ in range(4)]
    ids = sorted(generate_id() for _ in range(150))
    key(user, channel)
    async with AsyncSession(bind=cursor_db) as session:
        await session.execute(
            text(
                "INSERT INTO chat_messages "
                "SELECT id, :channel, :at, false, NULL, :sender, 'USER', NULL "
                "FROM unnest(CAST(:ids AS uuid[])) AS id"
            ),
            {"channel": channel, "at": AT, "sender": sender, "ids": ids},
        )
        monkeypatch.setattr(operations, "user_team_ids", AsyncMock(return_value=[]))
        ops = ChatReadStateOperations(session)
        await ops.mark_channel_unread(user, channel, ids[1])
        result = (await ops.get_unread_counts(user, org, [channel]))[channel]
        assert result["unread_count"] == 100
        assert result["first_unread_message_id"] == ids[1]


async def test_rewind_during_captured_flush_remains_dirty_and_survives_cache_miss(
    cursor_db,
    cursor_cache,
    monkeypatch,
):
    client, dirty, key = cursor_cache
    user, channel, message = [generate_id() for _ in range(3)]
    cache_key = key(user, channel)
    captured, resume = asyncio.Event(), asyncio.Event()
    earlier = ChannelCursor(generate_id(), message, AT)
    await cache_cursor(client, user, channel, earlier)

    @asynccontextmanager
    async def paused_factory():
        captured.set()
        await resume.wait()
        async with AsyncSession(bind=cursor_db) as session:
            yield session

    @asynccontextmanager
    async def session_factory():
        async with AsyncSession(bind=cursor_db) as session:
            yield session

    task = asyncio.create_task(flush._flush_channel_cursors(client, paused_factory))
    try:
        await asyncio.wait_for(captured.wait(), 5)
        async with AsyncSession(bind=cursor_db) as session:
            ops = ChatReadStateOperations(session)
            monkeypatch.setattr(ops, "_preceding_message", AsyncMock(return_value=None))
            await ops.mark_channel_unread(user, channel, message)
        resume.set()
        await task
        assert await client.sismember(dirty, f"{user}:{channel}")
        assert ChannelCursor.decode(await client.get(cache_key)).message_id is None
        await flush._flush_channel_cursors(client, session_factory)
        assert not await client.sismember(dirty, f"{user}:{channel}")
        await client.delete(cache_key)
        async with AsyncSession(bind=cursor_db) as session:
            assert await ChatReadStateOperations(session).get_channel_read_cursor(user, channel) == (
                None,
                EPOCH,
            )
    finally:
        resume.set()
        await task


async def test_persisted_rewind_rejects_older_flush_snapshot(cursor_db):
    user, channel, message = [generate_id() for _ in range(3)]
    earlier = ChannelCursor(generate_id(), message, AT)
    rewind = ChannelCursor(generate_id(), None, EPOCH)
    async with AsyncSession(bind=cursor_db) as session:
        await session.execute(upsert_cursors([rewind.row(user, channel)]))
        await session.commit()
        await session.execute(upsert_cursors([earlier.row(user, channel)]))
        await session.commit()
        row = (
            await session.execute(
                text("SELECT last_read_message_id, last_read_at, revision FROM chat_read_cursors")
            )
        ).one()
        assert row[0] is None
        assert row[1].replace(tzinfo=UTC) == EPOCH
        assert row[2] == rewind.revision


async def test_existing_cursor_accepts_first_revision(cursor_db):
    user, channel, message = [generate_id() for _ in range(3)]
    rewind = ChannelCursor(generate_id(), None, EPOCH)
    async with AsyncSession(bind=cursor_db) as session:
        await session.execute(
            text(
                "INSERT INTO chat_read_cursors (user_id, channel_id, last_read_message_id, last_read_at) "
                "VALUES (:user, :channel, :message, :at)"
            ),
            {"user": user, "channel": channel, "message": message, "at": AT},
        )
        await session.execute(upsert_cursors([rewind.row(user, channel)]))
        await session.commit()
        row = (
            await session.execute(
                text("SELECT last_read_message_id, revision FROM chat_read_cursors")
            )
        ).one()
        assert tuple(row) == (None, rewind.revision)


async def test_cache_warm_and_out_of_order_write_preserve_latest_mutation(cursor_cache):
    client, dirty, key = cursor_cache
    user, channel, message = [generate_id() for _ in range(3)]
    cache_key = key(user, channel)
    earlier = ChannelCursor(generate_id(), message, AT)
    rewind = ChannelCursor(generate_id(), None, EPOCH)
    await cache_cursor(client, user, channel, rewind)
    await warm_cursor(client, user, channel, earlier)
    await cache_cursor(client, user, channel, earlier)
    await clean_cursors(client, [(cache_key, earlier.encode(), f"{user}:{channel}")])
    assert ChannelCursor.decode(await client.get(cache_key)) == rewind
    assert await client.sismember(dirty, f"{user}:{channel}")


async def test_failed_flush_retains_pending_cursor(cursor_cache):
    client, dirty, key = cursor_cache
    user, channel, message = [generate_id() for _ in range(3)]
    key(user, channel)
    await cache_cursor(client, user, channel, ChannelCursor(generate_id(), message, AT))

    @asynccontextmanager
    async def unavailable_database():
        raise RuntimeError("database unavailable")
        yield

    assert await flush._flush_channel_cursors(client, unavailable_database) == 0
    assert await client.sismember(dirty, f"{user}:{channel}")
