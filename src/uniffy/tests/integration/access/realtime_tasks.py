"""A task description bound to a buffer epoch, with recording search, for durability suites."""

import contextlib
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from types import SimpleNamespace
from typing import Any

import pycrdt
import pytest_asyncio
from sqlalchemy import delete

from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.sprint import Sprint as _Sprint  # noqa: F401 - FK metadata
from uniffy.core.models.projects.task import Task
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.adapter import register_realtime_adapter
from uniffy.core.realtime.live import claim_seed
from uniffy.core.realtime.snapshot import persist_snapshot
from uniffy.core.realtime.storage import SeedLease
from uniffy.core.types import AccessMode, ContentType, generate_id
from uniffy.domains.projects.realtime import TaskRealtimeAdapter
from uniffy.tests.integration.access.realtime_live import buffered, stored
from uniffy.tests.integration.access.recording_search import (
    RecordingSearchEngine,
    recording_indexer,
)


@pytest_asyncio.fixture(loop_scope="session")
async def document(session, access, valkey_namespace) -> AsyncIterator[SimpleNamespace]:
    """A member's task in a private project, seeded and bound to a fresh buffer epoch."""
    project = Project(
        organization_id=access.org_id,
        owner_id=access.member_id,
        name="Durability",
        access_mode=AccessMode.OWNER_ONLY,
        slug=f"dur-{generate_id().hex[-12:]}",
    )
    session.add(project)
    await session.flush()
    task = Task(
        organization_id=access.org_id,
        owner_id=access.member_id,
        project_id=project.id,
        title="Durability",
        number=1,
        description="base",
    )
    session.add(task)
    await session.commit()
    engine = RecordingSearchEngine()
    indexer = recording_indexer(engine)
    adapter = TaskRealtimeAdapter(indexer)
    register_realtime_adapter(adapter)
    key = ContentType.TASK, task.id
    live = await buffered(key, access, valkey_namespace)
    yield SimpleNamespace(
        key=key,
        seed=await stored(key),
        access=access,
        adapter=adapter,
        engine=engine,
        indexer=indexer,
        live=live,
    )
    await session.rollback()
    await session.execute(
        delete(RealtimeYjsSnapshot).where(RealtimeYjsSnapshot.content_id == task.id)
    )
    await session.execute(delete(Task).where(Task.id == task.id))
    await session.execute(delete(Project).where(Project.id == project.id))
    await session.commit()


async def accepted(document: SimpleNamespace, doc: pycrdt.Doc) -> RealtimeYjsSnapshot:
    """Admit the editor's whole state like a live socket, then checkpoint it unprojected."""
    admitted = await document.live.admit_live(f"u-{generate_id().hex}", doc.get_update())
    assert admitted.applied
    return await document.live.checkpointed()


async def project(document: SimpleNamespace) -> None:
    await persist_snapshot(*document.key, document.access.org_id)


class _RenderGate:
    """The registered task adapter with a hook that runs before every render."""

    def __init__(self, inner: Any, before: Callable[[], Awaitable[None]]) -> None:
        self._inner = inner
        self._before = before
        self.content_type = inner.content_type

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    async def stage_render(self, *args: Any, **kwargs: Any) -> Any:
        await self._before()
        return await self._inner.stage_render(*args, **kwargs)


@contextlib.contextmanager
def gated_render(document, before: Callable[[], Awaitable[None]]) -> Iterator[None]:
    register_realtime_adapter(_RenderGate(document.adapter, before))
    try:
        yield
    finally:
        register_realtime_adapter(document.adapter)


async def lease(document: SimpleNamespace, candidate: str) -> SeedLease:
    """The seed lease once ``candidate`` stands for election alone."""
    replica = candidate.split(":")[0]
    held = await claim_seed(
        document.live.buffer, document.key, document.access.org_id, [candidate], replica
    )
    assert held is not None
    return held
