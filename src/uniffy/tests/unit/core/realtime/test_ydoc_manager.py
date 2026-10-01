from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pycrdt
import pytest

from uniffy.core.realtime.markdown import DOC_GENERATION_KEY, DOC_META_FIELD
from uniffy.core.realtime.ydoc_manager import YDocManager
from uniffy.core.types import ContentType, generate_id


@pytest.mark.parametrize(
    "content_type", [ContentType.NOTE, ContentType.TASK, ContentType.CALENDAR_EVENT]
)
async def test_domain_hydrate_stamps_distinct_generations(content_type: ContentType) -> None:
    db = MagicMock()
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: None))
    adapter = MagicMock()
    adapter.hydrate_ydoc = AsyncMock()
    adapter.policy_key = AsyncMock(return_value=None)

    @asynccontextmanager
    async def open_db():
        yield db

    manager = YDocManager()
    key = (content_type, generate_id())
    with (
        patch("uniffy.core.realtime.ydoc_manager.open_session", open_db),
        patch("uniffy.core.realtime.ydoc_manager.get_realtime_adapter", return_value=adapter),
    ):
        first = await manager._hydrate(key, generate_id())
        second = await manager._hydrate(key, generate_id())
    generation = first.ydoc.get(DOC_META_FIELD, type=pycrdt.Map)[DOC_GENERATION_KEY]
    assert isinstance(generation, str) and generation
    assert generation != second.ydoc.get(DOC_META_FIELD, type=pycrdt.Map)[DOC_GENERATION_KEY]


@pytest.mark.parametrize("generation", ["saved-generation", None])
async def test_snapshot_hydrate_preserves_generation(generation: str | None) -> None:
    saved = pycrdt.Doc()
    if generation is not None:
        saved.get(DOC_META_FIELD, type=pycrdt.Map)[DOC_GENERATION_KEY] = generation
    db = MagicMock()
    db.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=lambda: MagicMock(updates=saved.get_update()))
    )
    adapter = MagicMock()
    adapter.hydrate_ydoc = AsyncMock()
    adapter.policy_key = AsyncMock(return_value=None)

    @asynccontextmanager
    async def open_db():
        yield db

    with (
        patch("uniffy.core.realtime.ydoc_manager.open_session", open_db),
        patch("uniffy.core.realtime.ydoc_manager.get_realtime_adapter", return_value=adapter),
    ):
        hydrated = await YDocManager()._hydrate((ContentType.NOTE, generate_id()), generate_id())
    assert hydrated.ydoc.get(DOC_META_FIELD, type=pycrdt.Map).get(DOC_GENERATION_KEY) == generation
    adapter.hydrate_ydoc.assert_not_awaited()
