"""What a latest-state read trusts: narrow checkpoint row facts and the cache they validate."""

from collections import OrderedDict
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.buffer_keys import LatestState
from uniffy.core.realtime.state import DocKey


class CheckpointMoved(Exception):
    """The checkpoint changed between reading its facts and its bytes; read again."""


@dataclass(frozen=True, slots=True)
class CheckpointFacts:
    organization_id: UUID | None
    generation: str | None
    epoch: str | None
    run_id: str | None
    checkpoint_seq: int
    revision: int


def _matches(key: DocKey) -> tuple:
    return (
        RealtimeYjsSnapshot.content_type == key[0],
        RealtimeYjsSnapshot.content_id == key[1],
    )


async def read_facts(db: AsyncSession, key: DocKey) -> CheckpointFacts | None:
    row = (
        await db.execute(
            select(
                RealtimeYjsSnapshot.organization_id,
                RealtimeYjsSnapshot.generation,
                RealtimeYjsSnapshot.buffer_epoch,
                RealtimeYjsSnapshot.valkey_run_id,
                RealtimeYjsSnapshot.checkpoint_seq,
                RealtimeYjsSnapshot.revision,
            ).where(*_matches(key))
        )
    ).one_or_none()
    return None if row is None else CheckpointFacts(*row)


async def read_checkpoint(db: AsyncSession, key: DocKey, facts: CheckpointFacts) -> bytes:
    """Checkpoint bytes, only while the row still matches ``facts``."""
    updates = (
        await db.execute(
            select(RealtimeYjsSnapshot.updates).where(
                *_matches(key),
                RealtimeYjsSnapshot.revision == facts.revision,
                RealtimeYjsSnapshot.checkpoint_seq == facts.checkpoint_seq,
                RealtimeYjsSnapshot.buffer_epoch == facts.epoch,
            )
        )
    ).scalar_one_or_none()
    if updates is None:
        raise CheckpointMoved
    return updates


class LatestCache:
    """Per-process LRU of reconstructed documents, bounded by retained bytes."""

    def __init__(self, max_bytes: int) -> None:
        self._entries: OrderedDict[tuple[str, DocKey], LatestState] = OrderedDict()
        self._bytes = 0
        self._max_bytes = max_bytes

    def get(self, key: tuple[str, DocKey]) -> LatestState | None:
        state = self._entries.get(key)
        if state is not None:
            self._entries.move_to_end(key)
        return state

    def put(self, key: tuple[str, DocKey], state: LatestState) -> None:
        self.discard(key)
        if state.size > self._max_bytes:
            return
        self._entries[key] = state
        self._bytes += state.size
        while self._bytes > self._max_bytes:
            _, evicted = self._entries.popitem(last=False)
            self._bytes -= evicted.size

    def discard(self, key: tuple[str, DocKey]) -> None:
        state = self._entries.pop(key, None)
        if state is not None:
            self._bytes -= state.size
