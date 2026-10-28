"""The realtime router on live Valkey pubsub: per-document order without cross-document waits."""

import asyncio
from collections.abc import AsyncIterator
from uuid import UUID

import pycrdt
import pytest
import pytest_asyncio

from uniffy.core.realtime.publisher import (
    publish_checkpoint_progress,
    publish_content_replace,
    publish_doc_update,
)
from uniffy.core.realtime.router import RealtimeRouter, RemoteUpdate, RouterCallbacks
from uniffy.core.realtime.state import DocKey, YDocSession
from uniffy.core.realtime.wire import CheckpointProgress
from uniffy.core.types import ContentType, generate_id
from uniffy.infrastructure.valkey.pubsub import close_pubsub, init_pubsub

pytestmark = pytest.mark.asyncio(loop_scope="session")

TIMEOUT = 5.0


class Recorded:
    """Router callbacks that record what reached each document; ``hold`` blocks one document."""

    def __init__(self) -> None:
        self.events: list[tuple[DocKey, str, object]] = []
        self.hold: dict[DocKey, asyncio.Event] = {}
        self.changed = asyncio.Event()

    async def _record(self, key: DocKey, kind: str, value: object) -> None:
        self.events.append((key, kind, value))
        self.changed.set()
        if (held := self.hold.get(key)) is not None:
            await held.wait()

    async def apply_remote_update(self, session: YDocSession, remote: RemoteUpdate) -> None:
        await self._record(session.key, "record", remote.sequence)

    async def apply_checkpoint_progress(self, key: DocKey, progress: CheckpointProgress) -> None:
        await self._record(key, "progress", progress.covered_sequence)

    async def reload_document(self, key: DocKey) -> None:
        await self._record(key, "reload", None)

    def of(self, key: DocKey) -> list[tuple[str, object]]:
        return [(kind, value) for found, kind, value in self.events if found == key]

    async def until(self, key: DocKey, count: int, timeout: float = TIMEOUT) -> None:
        async with asyncio.timeout(timeout):
            while len(self.of(key)) < count:
                self.changed.clear()
                await self.changed.wait()

    def callbacks(self) -> RouterCallbacks:
        async def ignore(*_: object) -> None:
            return None

        return RouterCallbacks(
            apply_remote_update=self.apply_remote_update,
            apply_checkpoint_progress=self.apply_checkpoint_progress,
            reload_document=self.reload_document,
            close_stale_user_sessions=ignore,
            close_user_session_by_sid=ignore,
            close_user_org_handles=ignore,
            recheck_access=ignore,
        )


@pytest_asyncio.fixture(loop_scope="session")
async def router() -> AsyncIterator[tuple[RealtimeRouter, Recorded, DocKey, DocKey]]:
    await init_pubsub()
    recorded = Recorded()
    router = RealtimeRouter(replica=f"replica-{generate_id().hex}")
    router.register_callbacks(recorded.callbacks())
    keys = [(ContentType.NOTE, generate_id()) for _ in range(2)]
    for key in keys:
        router.register_doc_session(
            key, YDocSession(key=key, ydoc=pycrdt.Doc(), organization_id=generate_id())
        )
    await router.start()
    try:
        await subscribed(router, recorded, keys[1])
        yield router, recorded, keys[0], keys[1]
    finally:
        for held in recorded.hold.values():
            held.set()
        await router.stop()
        await close_pubsub()


async def progress(key: DocKey, covered: int) -> None:
    await publish_checkpoint_progress(
        *key, generation="g", epoch="e", covered_sequence=covered, checkpoint_revision=covered
    )


async def record(key: DocKey, sequence: int) -> None:
    await publish_doc_update(
        *key,
        b"sealed",
        generation="g",
        epoch="e",
        sequence=sequence,
        update_id=f"u-{sequence}",
        actor_id=generate_id(),
        origin_replica="other",
    )


async def subscribed(router: RealtimeRouter, recorded: Recorded, key: DocKey) -> None:
    """Wait until the router's pattern subscription delivers this document's channel."""
    for _ in range(100):
        await progress(key, 0)
        try:
            await recorded.until(key, 1, timeout=0.1)
            break
        except TimeoutError:
            continue
    recorded.events.clear()


async def test_a_document_waiting_on_a_reload_holds_up_no_other_document(router) -> None:
    _, recorded, busy, other = router
    recorded.hold[busy] = asyncio.Event()

    await progress(busy, 1)
    await recorded.until(busy, 1)
    await record(other, 1)
    await record(other, 2)
    await recorded.until(other, 2)

    assert recorded.of(busy) == [("progress", 1)]
    assert recorded.of(other) == [("record", 1), ("record", 2)]


async def test_queued_progress_collapses_to_the_newest_and_a_queued_reload_absorbs_records(
    router,
) -> None:
    _, recorded, busy, _ = router
    recorded.hold[busy] = asyncio.Event()
    await progress(busy, 1)
    await recorded.until(busy, 1)

    # While the first message waits, later ones queue behind it in publication order.
    await record(busy, 2)
    await progress(busy, 2)
    await progress(busy, 3)
    await publish_content_replace(*busy)
    await record(busy, 3)
    await progress(busy, 4)
    await asyncio.sleep(0.2)
    recorded.hold.pop(busy).set()
    await recorded.until(busy, 3)
    await asyncio.sleep(0.2)

    assert recorded.of(busy) == [("progress", 1), ("reload", None), ("progress", 4)]
