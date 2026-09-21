import asyncio
from unittest.mock import AsyncMock, MagicMock

import aiohttp
import pytest

from uniffy.domains.files.jobs.media import MediaError
from uniffy.domains.files.jobs.source import MediaSourceServer


@pytest.fixture
async def server():
    storage = MagicMock()
    storage.get_object_info = AsyncMock(return_value={"ContentLength": 10, "ETag": '"fixed"'})

    async def read(key, start, end, chunk_size, *, etag):
        assert key == "object" and etag == '"fixed"'
        yield b"0123456789"[start : end + 1], 10, start, end

    storage.download_range.side_effect = read
    bridge = MediaSourceServer(storage)
    await bridge.startup()
    try:
        yield bridge, storage
    finally:
        await bridge.shutdown()


@pytest.mark.parametrize(
    "span, expected, content_range",
    [
        ("bytes=2-5", b"2345", "bytes 2-5/10"),
        ("bytes=8-", b"89", "bytes 8-9/10"),
        ("bytes=-3", b"789", "bytes 7-9/10"),
        ("bytes=0-999", b"0123456789", "bytes 0-9/10"),
    ],
)
async def test_seekable_ranges_and_token_expiry(server, span, expected, content_range):
    bridge, storage = server
    async with aiohttp.ClientSession() as client:
        async with bridge.open("object", 10) as source:
            async with client.get(source.url, headers={"Range": span}) as response:
                assert response.status == 206
                assert response.headers["Content-Range"] == content_range
                assert await response.read() == expected
        async with client.get(source.url) as response:
            assert response.status == 404
    storage.download_range.assert_called_once()


@pytest.mark.parametrize("span", ["bytes=10-", "bytes=5-2", "bytes=0-1,3-4", "bad", "bytes=-0"])
async def test_invalid_ranges_do_not_read_storage(server, span):
    bridge, storage = server
    async with bridge.open("object", 10) as source, aiohttp.ClientSession() as client:
        async with client.get(source.url, headers={"Range": span}) as response:
            assert response.status == 416
            assert response.headers["Content-Range"] == "bytes */10"
    storage.download_range.assert_not_called()


async def test_head_and_unbound_requests_do_not_read_storage(server):
    bridge, storage = server
    async with bridge.open("object", 10) as source, aiohttp.ClientSession() as client:
        async with client.head(source.url) as response:
            assert response.status == 200
            assert response.headers["Content-Length"] == "10"
            assert not await response.read()
        for url, kwargs in [
            (source.url + "?key=other", {}),
            (source.url + "/other", {}),
            (source.url, {"headers": {"Host": "attacker.example"}}),
        ]:
            async with client.get(url, **kwargs) as response:
                assert response.status == 404
        async with client.post(source.url) as response:
            assert response.status == 405
    storage.download_range.assert_not_called()


@pytest.mark.parametrize("size", [0, 11])
async def test_source_cap_checked_before_read(server, size):
    bridge, storage = server
    storage.get_object_info.return_value["ContentLength"] = size
    with pytest.raises(MediaError, match="source size limit"):
        async with bridge.open("object", 10):
            pytest.fail("Source must be rejected")
    storage.download_range.assert_not_called()


async def test_storage_failure_remains_retryable(server):
    bridge, storage = server
    storage.download_range.side_effect = OSError("storage offline")
    with pytest.raises(OSError, match="storage offline"):
        async with bridge.open("object", 10) as source, aiohttp.ClientSession() as client:
            async with client.get(source.url) as response:
                assert response.status == 502
            raise MediaError("ffmpeg failed")


async def test_changed_size_rejects_bytes(server):
    bridge, storage = server

    async def changed(*args, **kwargs):
        yield b"0123456789", 11, 0, 9

    storage.download_range.side_effect = changed
    with pytest.raises(MediaError, match="source changed"):
        async with bridge.open("object", 10) as source, aiohttp.ClientSession() as client:
            async with client.get(source.url) as response:
                assert response.status == 502


async def test_disconnect_closes_storage_reader(server):
    bridge, storage = server
    size = 8 * 1024**3
    storage.get_object_info.return_value["ContentLength"] = size
    closed = asyncio.Event()
    emitted = 0

    async def stream(key, start, end, chunk_size, *, etag):
        nonlocal emitted
        try:
            for _ in range(size // chunk_size):
                emitted += chunk_size
                yield bytes(chunk_size), size, start, end
                await asyncio.sleep(0)
        finally:
            closed.set()

    storage.download_range.side_effect = stream
    async with bridge.open("object", size) as source, aiohttp.ClientSession() as client:
        async with client.get(source.url) as response:
            assert await response.content.read(1) == b"\x00"
        async with asyncio.timeout(2):
            await closed.wait()
    assert emitted < 16 * 1024**2


async def test_cancellation_revokes_source_and_closes_inflight_reader(server):
    bridge, storage = server
    reading = asyncio.Event()
    closed = asyncio.Event()

    async def stalled(*args, **kwargs):
        try:
            reading.set()
            await asyncio.Event().wait()
            yield b"", 10, 0, 9
        finally:
            closed.set()

    storage.download_range.side_effect = stalled
    address = []

    async def job():
        async with bridge.open("object", 10) as source:
            address.append(source.url)
            async with aiohttp.ClientSession() as client, client.get(source.url):
                pytest.fail("Stalled source must not finish")

    task = asyncio.create_task(job())
    async with asyncio.timeout(2):
        await reading.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert closed.is_set()
    async with aiohttp.ClientSession() as client, client.get(address[0]) as response:
        assert response.status == 404
