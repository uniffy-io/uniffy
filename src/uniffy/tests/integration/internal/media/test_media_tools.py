import io
from unittest.mock import AsyncMock, MagicMock

import aiohttp
import pytest
import pytest_asyncio
from PIL import Image

from uniffy.core.json_codec import loads
from uniffy.domains.files.jobs.media import (
    MediaError,
    is_web_safe,
    probe,
    rendition_args,
    run_media,
    thumbnail_args,
)
from uniffy.domains.files.jobs.settings import MediaSettings
from uniffy.domains.files.jobs.transcode import _run_ffmpeg
from uniffy.domains.files.jobs.source import MediaSourceServer
from uniffy.infrastructure.storage import S3Storage
from uniffy.core.types import generate_id


@pytest_asyncio.fixture
async def range_source(video_samples):
    storage = S3Storage()
    await storage.startup()
    bridge = MediaSourceServer(storage)
    await bridge.startup()
    keys = []

    async def upload(name):
        key = f"test/media-range/{generate_id()}"
        keys.append(key)
        await storage.upload_bytes(key, (video_samples / name).read_bytes())
        return bridge.open(key, 8 * 1024**3)

    try:
        yield upload
    finally:
        await bridge.shutdown()
        for key in keys:
            await storage.delete_object(key)
        await storage.shutdown()


@pytest.mark.parametrize(
    "name",
    [
        "h264.mov",
        "hevc.mp4",
        "vp9.webm",
        "av1.mkv",
        "rotated.mp4",
        "odd.webm",
        "large.mp4",
        "hdr.mp4",
    ],
)
async def test_real_video_conversion_and_thumbnail(name, tmp_path, video_samples):
    source = video_samples / name
    info = await probe(source)
    if name in {"hevc.mp4", "hdr.mp4"}:
        assert info.video["codec_name"] == "hevc"
    if name == "vp9.webm":
        assert info.video["codec_name"] == "vp9"
    if name == "av1.mkv":
        assert info.video["codec_name"] == "av1"
    if name == "hdr.mp4":
        assert info.hdr
    output = tmp_path / "playback.mp4"
    await run_media("ffmpeg", rendition_args(source, output, info, MediaSettings()), 60)
    result = await probe(output)
    assert is_web_safe(result)
    assert result.video["width"] <= 1920 and result.video["height"] <= 1080
    assert result.video["width"] % 2 == result.video["height"] % 2 == 0
    assert result.duration >= info.duration - 0.1
    assert bool(result.audio) == bool(info.audio)
    if name == "rotated.mp4":
        assert result.video["width"] == 108 and result.video["height"] == 192
    if name == "hdr.mp4":
        assert not result.hdr
        assert result.video["color_transfer"] == "bt709"
    if name == "large.mp4":
        assert (result.video["width"], result.video["height"]) == (1920, 1080)
    data = output.read_bytes()
    assert data.index(b"moov") < data.index(b"mdat")
    frame = await run_media("ffmpeg", thumbnail_args(source, info), 30)
    with Image.open(io.BytesIO(frame)) as image:
        assert 0 < image.width <= 400 and 0 < image.height <= 400


async def test_safe_mov_is_recognized_without_encoding(video_samples):
    assert is_web_safe(await probe(video_samples / "h264.mov"))
    assert not is_web_safe(await probe(video_samples / "hevc.mp4"))


async def test_corrupt_video_fails_with_bounded_error(tmp_path):
    source = tmp_path / "broken.mp4"
    source.write_bytes(b"invalid")
    with pytest.raises(MediaError) as error:
        await probe(source)
    assert len(str(error.value)) < 9000


@pytest.mark.parametrize("kind", ["silent", "audio"])
async def test_streamed_recording_without_indexed_duration(kind, tmp_path, video_samples):
    source = video_samples / f"recording-{kind}.webm"
    metadata = loads(
        await run_media("ffprobe", ["-v", "error", "-show_format", "-of", "json", str(source)], 30)
    )
    assert "duration" not in metadata["format"]
    info = await probe(source)
    assert 0.9 <= info.duration <= 1.1
    assert bool(info.audio) == (kind == "audio")
    frame = await run_media("ffmpeg", thumbnail_args(source, info), 30)
    with Image.open(io.BytesIO(frame)) as image:
        assert image.size == (192, 108)
    output = tmp_path / "recording.mp4"
    await _run_ffmpeg(source, output)
    result = await probe(output)
    assert is_web_safe(result)
    assert bool(result.audio) == bool(info.audio)
    assert result.duration >= info.duration - 0.1


@pytest.mark.parametrize(
    "name",
    [
        "h264.mov",
        "hevc.mp4",
        "vp9.webm",
        "av1.mkv",
        "rotated.mp4",
        "odd.webm",
        "large.mp4",
        "hdr.mp4",
        "recording-silent.webm",
        "recording-audio.webm",
    ],
)
async def test_object_range_probe_thumbnail_and_encode(name, range_source, tmp_path):
    async with await range_source(name) as source:
        info = await probe(source)
        frame = await run_media("ffmpeg", thumbnail_args(source, info), 30)
        with Image.open(io.BytesIO(frame)) as image:
            assert 0 < image.width <= 400 and 0 < image.height <= 400
        output = tmp_path / "output.mp4"
        await _run_ffmpeg(source, output)
    result = await probe(output)
    assert is_web_safe(result)
    assert bool(result.audio) == bool(info.audio)
    assert result.duration >= info.duration - 0.1
    assert list(tmp_path.iterdir()) == [output]


async def test_eight_gib_mov_seeks_to_tail_without_downloading_padding(video_samples, tmp_path):
    tail = tmp_path / "tail.mp4"
    await run_media(
        "ffmpeg",
        [
            "-y",
            "-nostdin",
            "-v",
            "error",
            "-i",
            str(video_samples / "h264.mov"),
            "-c",
            "copy",
            str(tail),
        ],
        30,
    )
    original = tail.read_bytes()
    moov = original.index(b"moov") - 4
    assert original.index(b"mdat") < moov
    size = 8 * 1024**3
    gap = size - len(original)
    prefix = original[:moov] + (1).to_bytes(4, "big") + b"free" + gap.to_bytes(8, "big")
    suffix = original[moov:]
    suffix_start = size - len(suffix)
    storage = MagicMock()
    storage.get_object_info = AsyncMock(return_value={"ContentLength": size, "ETag": '"sparse"'})
    fetched = 0
    offsets = []

    async def read(key, start, end, chunk_size, *, etag):
        nonlocal fetched
        offsets.append(start)
        cursor = start
        while cursor <= end:
            stop = min(cursor + chunk_size, end + 1)
            chunk = bytearray(stop - cursor)
            for offset, data in [(0, prefix), (suffix_start, suffix)]:
                first, last = max(cursor, offset), min(stop, offset + len(data))
                if first < last:
                    chunk[first - cursor : last - cursor] = data[first - offset : last - offset]
            fetched += len(chunk)
            yield bytes(chunk), size, start, end
            cursor = stop

    storage.download_range.side_effect = read
    bridge = MediaSourceServer(storage)
    await bridge.startup()
    try:
        async with bridge.open("sparse", size) as source:
            info = await probe(source)
            assert is_web_safe(info)
            await run_media("ffmpeg", thumbnail_args(source, info), 30)
            await _run_ffmpeg(source, tmp_path / "output.mp4")
        assert any(offset >= suffix_start for offset in offsets)
        assert fetched < 32 * 1024**2
        assert is_web_safe(await probe(tmp_path / "output.mp4"))
    finally:
        await bridge.shutdown()


async def test_corrupt_range_source_error_hides_temporary_url():
    storage = S3Storage()
    await storage.startup()
    key = f"test/media-range/{generate_id()}"
    bridge = MediaSourceServer(storage)
    await bridge.startup()
    try:
        await storage.upload_bytes(key, b"invalid video bytes")
        async with bridge.open(key, 1024) as source:
            with pytest.raises(MediaError) as error:
                await probe(source)
            assert source.url not in str(error.value)
            assert source.url.rsplit("/", 1)[-1] not in str(error.value)
            assert "[media source]" in str(error.value)
            assert "Invalid data" in str(error.value)
    finally:
        await bridge.shutdown()
        await storage.delete_object(key)
        await storage.shutdown()


async def test_object_replacement_cannot_mix_range_bytes():
    storage = S3Storage()
    await storage.startup()
    key = f"test/media-range/{generate_id()}"
    bridge = MediaSourceServer(storage)
    await bridge.startup()
    try:
        await storage.upload_bytes(key, b"first")
        with pytest.raises(Exception, match="PreconditionFailed|precondition"):
            async with bridge.open(key, 10) as source:
                await storage.upload_bytes(key, b"other")
                async with aiohttp.ClientSession() as client, client.get(source.url) as response:
                    assert response.status == 502
    finally:
        await bridge.shutdown()
        await storage.delete_object(key)
        await storage.shutdown()
