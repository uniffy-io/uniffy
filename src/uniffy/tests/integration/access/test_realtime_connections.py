"""Attached idle documents share the process connections; none holds a connection of its own."""

import asyncio
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any

import pytest
import pytest_asyncio
import valkey.asyncio as aioredis
from prometheus_client import REGISTRY
from sqlalchemy import text

from uniffy.core.models.notes.note import Note
from uniffy.core.realtime.adapter import register_realtime_adapter
from uniffy.core.realtime.limits import MAX_DOCS_PER_SOCKET
from uniffy.core.realtime.wire import YMessageType, YSyncMessageType
from uniffy.core.realtime.ydoc_manager import YDocManager
from uniffy.core.types import ContentType, generate_id
from uniffy.domains.notes.adapter import NoteRealtimeAdapter
from uniffy.infrastructure.database.session import open_session
from uniffy.infrastructure.valkey.config import ValkeyConfig
from uniffy.tests.integration.access.realtime_live import BufferedDocument, buffered, stored
from uniffy.tests.integration.access.realtime_sockets import (
    QUIET_SECONDS,
    Client,
    connect,
    evicted,
    routed,
    step,
)
from uniffy.tests.integration.access.recording_search import recording_indexer

pytestmark = pytest.mark.asyncio(loop_scope="session")

SOCKETS = 3
ROUND_DOCUMENTS = SOCKETS * MAX_DOCS_PER_SOCKET
# Attaches run one at a time, so a pool may add a connection or two; a connection held per
# document would add one for every document attached after the baseline.
TOLERANCE = 4
IDLE_SECONDS = 1.0
# Another process on this host, such as a reloading dev backend, can open connections during one
# round. Each round attaches documents no earlier round touched, so a connection held per
# document shows up in every round.
ROUNDS = 2


@pytest_asyncio.fixture(loop_scope="session")
async def idle_notes(access: Any, valkey_namespace: str) -> list[BufferedDocument]:
    """One document for the baseline socket and full sockets' worth per round, each with an epoch.

    The access fixture's teardown removes the notes and their snapshot rows with the organization.
    """
    register_realtime_adapter(NoteRealtimeAdapter(recording_indexer()))
    notes = [
        Note(
            organization_id=access.org_id,
            owner_id=access.member_id,
            title=f"Idle {index}",
            slug=f"idle-{generate_id().hex}",
            content="base",
        )
        for index in range(1 + ROUNDS * ROUND_DOCUMENTS)
    ]
    async with open_session() as db:
        db.add_all(notes)
        await db.commit()
    return [await buffered((ContentType.NOTE, note.id), access, valkey_namespace) for note in notes]


@pytest_asyncio.fixture(loop_scope="session")
async def observer() -> AsyncIterator[aioredis.Redis]:
    """A Valkey client for server introspection, outside the fail-fast deadlines of the buffer."""
    client = aioredis.from_url(ValkeyConfig.from_env().to_url())
    try:
        yield client
    finally:
        await client.aclose()


async def database_clock() -> datetime:
    async with open_session() as db:
        return (await db.execute(text("SELECT clock_timestamp()"))).scalar_one()


async def database_connections_opened_since(since: datetime) -> int:
    """This application's connections from this host opened after ``since`` and still open."""
    async with open_session() as db:
        return (
            await db.execute(
                text(
                    "SELECT count(*) FROM pg_stat_activity"
                    " WHERE usename = current_user AND datname = current_database()"
                    " AND application_name = current_setting('application_name')"
                    " AND client_addr IS NOT DISTINCT FROM inet_client_addr()"
                    " AND backend_start > :since"
                ),
                {"since": since},
            )
        ).scalar_one()


def host_of(address: object) -> str:
    return str(address).rsplit(":", 1)[0]


async def newest_valkey_client(observer: aioredis.Redis) -> int:
    return max(int(client["id"]) for client in await observer.client_list())


async def valkey_clients_connected_after(observer: aioredis.Redis, newest: int) -> int:
    """Connected clients from this host whose id, which Valkey assigns in order, follows ``newest``."""
    host = host_of((await observer.client_info())["addr"])
    return sum(
        int(client["id"]) > newest and host_of(client["addr"]) == host
        for client in await observer.client_list()
    )


def subscribers() -> float:
    return REGISTRY.get_sample_value("uniffy_pubsub_active_subscribers", {}) or 0.0


async def attach_on(opener: Client, document: BufferedDocument) -> None:
    """Attach ``document`` on the socket ``opener`` holds."""
    client = Client(opener.socket, opener.task, document.key)
    client.sync()
    await client.until(YMessageType.SYNC, step(YSyncMessageType.SYNC_STEP2))


async def attach_round(
    manager: YDocManager, documents: list[BufferedDocument], observer: aioredis.Redis
) -> tuple[int, int]:
    """Attach ``documents`` on full sockets, idle, and count the connections opened meanwhile."""
    since, newest = await database_clock(), await newest_valkey_client(observer)
    listening = subscribers()
    sockets: list[Client] = []
    try:
        for start in range(0, len(documents), MAX_DOCS_PER_SOCKET):
            batch = documents[start : start + MAX_DOCS_PER_SOCKET]
            sockets.append(connect(manager, batch[0].key, batch[0].org, batch[0].owner))
            for document in batch:
                await attach_on(sockets[-1], document)
        assert len(sockets) == SOCKETS
        assert all(manager.resident(document.key) is not None for document in documents)
        await asyncio.sleep(IDLE_SECONDS)
        # The process keeps one router subscription however many documents are attached.
        assert subscribers() == listening
        return (
            await database_connections_opened_since(since),
            await valkey_clients_connected_after(observer, newest),
        )
    finally:
        for client in sockets:
            await client.leave()
        for document in documents:
            await evicted(manager, document.key)


async def test_many_idle_documents_on_full_sockets_keep_connections_at_the_one_document_baseline(
    idle_notes: list[BufferedDocument], observer: aioredis.Redis
) -> None:
    first, rest = idle_notes[0], idle_notes[1:]
    rows = [await stored(note.key) for note in idle_notes]

    async with routed(first, 1) as (manager,):
        baseline = connect(manager, first.key, first.org, first.owner)
        try:
            await attach_on(baseline, first)
            growth: list[tuple[int, int]] = []
            for start in range(0, len(rest), ROUND_DOCUMENTS):
                await asyncio.sleep(QUIET_SECONDS)
                documents = rest[start : start + ROUND_DOCUMENTS]
                growth.append(await attach_round(manager, documents, observer))
        finally:
            await baseline.leave()

    assert len(growth) == ROUNDS
    opened = min(database for database, _ in growth)
    connected = min(valkey for _, valkey in growth)
    assert opened <= TOLERANCE, growth
    assert connected <= TOLERANCE, growth
    # Idle documents are only read: no checkpoint commits, and no record enters the buffer.
    after = [await stored(note.key) for note in idle_notes]
    assert [(row.updates, row.revision, row.checkpoint_seq, row.updated_at) for row in after] == [
        (row.updates, row.revision, row.checkpoint_seq, row.updated_at) for row in rows
    ]
    streams = observer.scan_iter(match=f"{first.namespace}*:stream:*")
    assert [key async for key in streams] == []
