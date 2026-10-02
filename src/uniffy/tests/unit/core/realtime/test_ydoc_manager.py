import asyncio
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pycrdt
import pytest

from uniffy.core.realtime.markdown import DOC_GENERATION_KEY, DOC_META_FIELD
from uniffy.core.realtime.state import YDocSession
from uniffy.core.realtime.ydoc_manager import YDocManager
from uniffy.core.types import ContentType, generate_id


@pytest.mark.parametrize("generation", ["saved-generation", None])
async def test_snapshot_hydrate_preserves_generation(generation: str | None) -> None:
    saved = pycrdt.Doc()
    if generation is not None:
        saved.get(DOC_META_FIELD, type=pycrdt.Map)[DOC_GENERATION_KEY] = generation
    db = MagicMock()
    db.commit = AsyncMock()
    adapter = MagicMock()
    adapter.hydrate_ydoc = AsyncMock()
    adapter.policy_key = AsyncMock(return_value=None)

    @asynccontextmanager
    async def open_db():
        yield db

    with (
        patch("uniffy.core.realtime.ydoc_manager.open_session", open_db),
        patch("uniffy.core.realtime.ydoc_manager.lock_document", AsyncMock()),
        patch(
            "uniffy.core.realtime.ydoc_manager.stage_seed",
            AsyncMock(return_value=MagicMock(updates=saved.get_update())),
        ),
        patch("uniffy.core.realtime.ydoc_manager.get_realtime_adapter", return_value=adapter),
    ):
        hydrated = await YDocManager()._hydrate((ContentType.NOTE, generate_id()), generate_id())
    assert hydrated.ydoc.get(DOC_META_FIELD, type=pycrdt.Map).get(DOC_GENERATION_KEY) == generation
    adapter.hydrate_ydoc.assert_not_awaited()


async def test_failed_eviction_retains_document_and_retries() -> None:
    manager = YDocManager()
    key = (ContentType.TASK, generate_id())
    doc = pycrdt.Doc()
    doc["markdown"] = pycrdt.Text("pending work")
    session = YDocSession(key=key, ydoc=doc, organization_id=generate_id())
    manager._sessions[key] = session
    with (
        patch("uniffy.core.realtime.ydoc_manager.IDLE_EVICTION_SECONDS", 0),
        patch(
            "uniffy.core.realtime.ydoc_manager.snapshot_writer.flush",
            AsyncMock(side_effect=OSError("database unavailable")),
        ),
        patch("uniffy.core.realtime.ydoc_manager.router.unregister_doc_session") as unregister,
    ):
        await manager._evict_after_idle(key)
        assert manager._sessions[key] is session
        assert session.eviction_task is not None
        unregister.assert_not_called()
        session.eviction_task.cancel()
        await asyncio.gather(session.eviction_task, return_exceptions=True)
