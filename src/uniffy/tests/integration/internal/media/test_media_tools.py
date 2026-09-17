import io

import pytest
from PIL import Image

from uniffy.domains.files.jobs.media import (
    MediaError,
    is_web_safe,
    probe,
    rendition_args,
    run_media,
    thumbnail_args,
)
from uniffy.domains.files.jobs.settings import MediaSettings


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
