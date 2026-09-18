import asyncio
from dataclasses import replace
from unittest.mock import AsyncMock

import pytest

from uniffy.core.types import generate_id
from uniffy.domains.files.jobs import renditions, slots, transcode
from uniffy.vendor.arq import Retry


class LeaseStore:
    def __init__(self):
        self.held = {}

    async def set(self, key, token, *, ex, nx):
        if key in self.held:
            return False
        self.held[key] = token
        return True

    async def eval(self, script, count, key, token, *args):
        if self.held.get(key) != token:
            return 0
        if not args:
            del self.held[key]
        return 1


async def test_busy_media_jobs_return_without_waiting_for_running_encode(monkeypatch):
    client = LeaseStore()
    monkeypatch.setattr(slots, "get_ops_client", lambda: client)
    monkeypatch.setattr(slots, "MEDIA_SETTINGS", replace(slots.MEDIA_SETTINGS, max_concurrent=1))
    async with slots.media_slot() as acquired:
        assert acquired

        async def contender():
            async with slots.media_slot() as granted:
                return granted

        async with asyncio.timeout(1):
            assert not any(await asyncio.gather(*(contender() for _ in range(50))))
    assert not client.held
    async with slots.media_slot() as acquired:
        assert acquired


async def test_cancellation_releases_owned_slot(monkeypatch):
    client = LeaseStore()
    monkeypatch.setattr(slots, "get_ops_client", lambda: client)
    started = asyncio.Event()

    async def encode():
        async with slots.media_slot() as acquired:
            assert acquired
            started.set()
            await asyncio.Event().wait()

    task = asyncio.create_task(encode())
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not client.held


async def test_busy_handlers_defer_without_claiming_conversion_attempts(monkeypatch):
    client = LeaseStore()
    monkeypatch.setattr(slots, "get_ops_client", lambda: client)
    monkeypatch.setattr(slots, "MEDIA_SETTINGS", replace(slots.MEDIA_SETTINGS, max_concurrent=1))
    claim, convert = AsyncMock(), AsyncMock()
    monkeypatch.setattr(renditions, "claim_playback", claim)
    monkeypatch.setattr(transcode, "_transcode_video_to_mp4", convert)
    async with slots.media_slot():
        for handler in (renditions.generate_playback_rendition, transcode.transcode_video_to_mp4):
            with pytest.raises(Retry) as retry:
                await handler({}, str(generate_id()), str(generate_id()))
            assert retry.value.defer_score == 5000
            assert not retry.value.count_attempt
    claim.assert_not_awaited()
    convert.assert_not_awaited()
