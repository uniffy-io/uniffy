import asyncio
from contextlib import AsyncExitStack
from dataclasses import replace
from unittest.mock import AsyncMock

import pytest

from uniffy.core.types import generate_id
from uniffy.domains.files.jobs import renditions, transcode
from uniffy.domains.files.jobs import slots as slots_mod
from uniffy.domains.files.jobs.settings import MediaSettings
from uniffy.domains.files.jobs.slots import MEDIA_SLOTS_CTX_KEY, MediaSlots
from uniffy.vendor.arq import Retry


@pytest.fixture(autouse=True)
def available_scratch(monkeypatch):
    monkeypatch.setattr(slots_mod, "_available_bytes", lambda *args: 64 * 1024**3)


_SETTINGS = MediaSettings(max_output_bytes=1024**2)


@pytest.mark.parametrize("capacity", [1, 2, 4])
async def test_busy_media_jobs_return_without_waiting_for_running_encodes(capacity):
    slots = MediaSlots(capacity, _SETTINGS)
    async with AsyncExitStack() as held:
        for _ in range(capacity):
            assert await held.enter_async_context(slots.acquire())

        async def contender():
            async with slots.acquire() as granted:
                return granted

        async with asyncio.timeout(1):
            assert not any(await asyncio.gather(*(contender() for _ in range(50))))
        async with slots.acquire() as acquired:
            assert not acquired
    async with slots.acquire() as acquired:
        assert acquired


async def test_cancellation_releases_worker_slot():
    slots = MediaSlots(1, _SETTINGS)
    started = asyncio.Event()

    async def encode():
        async with slots.acquire() as acquired:
            assert acquired
            started.set()
            await asyncio.Event().wait()

    task = asyncio.create_task(encode())
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    async with slots.acquire() as acquired:
        assert acquired


async def test_failure_releases_worker_slot():
    slots = MediaSlots(1, _SETTINGS)
    with pytest.raises(RuntimeError, match="encode failed"):
        async with slots.acquire() as acquired:
            assert acquired
            raise RuntimeError("encode failed")
    async with slots.acquire() as acquired:
        assert acquired


async def test_busy_handlers_defer_without_blocking_another_worker(monkeypatch):
    busy_worker = {MEDIA_SLOTS_CTX_KEY: MediaSlots(1, _SETTINGS)}
    idle_worker = {MEDIA_SLOTS_CTX_KEY: MediaSlots(1, _SETTINGS)}
    claim = AsyncMock(return_value=None)
    convert = AsyncMock(return_value={"status": "success"})
    monkeypatch.setattr(renditions, "claim_playback", claim)
    monkeypatch.setattr(transcode, "_transcode_video_to_mp4", convert)
    async with busy_worker[MEDIA_SLOTS_CTX_KEY].acquire():
        for handler in (renditions.generate_playback_rendition, transcode.transcode_video_to_mp4):
            with pytest.raises(Retry) as retry:
                await handler(busy_worker, str(generate_id()), str(generate_id()))
            assert retry.value.defer_score == 5000
            assert not retry.value.count_attempt
        claim.assert_not_awaited()
        convert.assert_not_awaited()
        await renditions.generate_playback_rendition(
            idle_worker, str(generate_id()), str(generate_id())
        )
        await transcode.transcode_video_to_mp4(idle_worker, str(generate_id()), str(generate_id()))
    claim.assert_awaited_once()
    convert.assert_awaited_once()


async def test_recording_and_fallback_share_worker_capacity(monkeypatch):
    worker = {MEDIA_SLOTS_CTX_KEY: MediaSlots(2, _SETTINGS)}
    entered = asyncio.Event()
    release = asyncio.Event()
    running = 0

    async def conversion(*args):
        nonlocal running
        running += 1
        if running == 2:
            entered.set()
        await release.wait()

    monkeypatch.setattr(renditions, "claim_playback", conversion)
    monkeypatch.setattr(transcode, "_transcode_video_to_mp4", conversion)
    jobs = [
        asyncio.create_task(handler(worker, str(generate_id()), str(generate_id())))
        for handler in (renditions.generate_playback_rendition, transcode.transcode_video_to_mp4)
    ]
    try:
        async with asyncio.timeout(1):
            await entered.wait()
        for handler in (renditions.generate_playback_rendition, transcode.transcode_video_to_mp4):
            with pytest.raises(Retry):
                await handler(worker, str(generate_id()), str(generate_id()))
        assert running == 2
    finally:
        release.set()
        await asyncio.gather(*jobs)
    async with worker[MEDIA_SLOTS_CTX_KEY].acquire() as acquired:
        assert acquired


async def test_scratch_pressure_defers_before_claim_and_recovers(monkeypatch):
    free = 8 * 1024**3
    monkeypatch.setattr(slots_mod, "_available_bytes", lambda *args: free)
    worker = {MEDIA_SLOTS_CTX_KEY: MediaSlots(4, MediaSettings())}
    claim = AsyncMock(return_value=None)
    convert = AsyncMock(return_value={"status": "success"})
    monkeypatch.setattr(renditions, "claim_playback", claim)
    monkeypatch.setattr(transcode, "_transcode_video_to_mp4", convert)
    async with worker[MEDIA_SLOTS_CTX_KEY].acquire() as acquired:
        assert acquired
        for handler in (renditions.generate_playback_rendition, transcode.transcode_video_to_mp4):
            with pytest.raises(Retry) as retry:
                await handler(worker, str(generate_id()), str(generate_id()))
            assert not retry.value.count_attempt
        claim.assert_not_awaited()
        convert.assert_not_awaited()
        free = 16 * 1024**3
        await renditions.generate_playback_rendition(worker, str(generate_id()), str(generate_id()))
        claim.assert_awaited_once()


def test_impossible_scratch_configuration_fails_on_startup():
    with pytest.raises(ValueError, match="cannot fit"):
        MediaSlots(2, replace(MediaSettings(), scratch_max_bytes=4 * 1024**3))


def test_leftover_scratch_consumes_budget(tmp_path, monkeypatch):
    monkeypatch.undo()
    path = tmp_path / "abandoned.mp4"
    path.write_bytes(bytes(8192))
    available = slots_mod._available_bytes(str(tmp_path), 16384)
    assert 0 <= available <= 8192
