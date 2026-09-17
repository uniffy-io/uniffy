import asyncio
from pathlib import Path

import pytest

from uniffy.core.json_codec import dumps_bytes
from uniffy.domains.files.jobs import media


def make_probe(**video):
    return media.parse_probe(
        dumps_bytes({
            "format": {"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "duration": "3"},
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "h264",
                    "profile": "High",
                    "pix_fmt": "yuv420p",
                    "width": 1920,
                    "height": 1080,
                    **video,
                }
            ],
        })
    )


@pytest.mark.parametrize(
    "changes",
    [
        {"codec_name": "hevc"},
        {"profile": "High 10"},
        {"pix_fmt": "yuv422p"},
        {"width": 7680},
        {"color_transfer": "smpte2084"},
    ],
)
def test_unsupported_original_needs_compatibility_copy(changes):
    assert not media.is_web_safe(make_probe(**changes))


def test_h264_mov_without_audio_needs_no_copy():
    assert media.is_web_safe(make_probe())


def test_malformed_or_unbounded_duration_is_rejected():
    for duration in (0, "nan", "inf", "unknown"):
        with pytest.raises(media.MediaError):
            media.parse_probe(dumps_bytes({"format": {"duration": duration}, "streams": []}))


class Process:
    def __init__(self, *, code=None, stdout=b"", stderr=b""):
        self.stdout = asyncio.StreamReader()
        self.stderr = asyncio.StreamReader()
        self.stdout.feed_data(stdout)
        self.stderr.feed_data(stderr)
        self.returncode = code
        self.done = asyncio.Event()
        self.killed = False
        if code is not None:
            self.stdout.feed_eof()
            self.stderr.feed_eof()
            self.done.set()

    def kill(self):
        self.killed = True
        self.returncode = -9
        self.stdout.feed_eof()
        self.stderr.feed_eof()
        self.done.set()

    async def wait(self):
        await self.done.wait()
        return self.returncode


async def test_timeout_reaps_child(monkeypatch):
    process = Process()

    async def spawn(*args, **kwargs):
        return process

    monkeypatch.setattr(media.asyncio, "create_subprocess_exec", spawn)
    with pytest.raises(TimeoutError):
        await media.run_media("ffmpeg", [], 0.01)
    assert process.killed and process.done.is_set()


async def test_cancellation_reaps_child(monkeypatch):
    process = Process()
    started = asyncio.Event()

    async def spawn(*args, **kwargs):
        started.set()
        return process

    monkeypatch.setattr(media.asyncio, "create_subprocess_exec", spawn)
    task = asyncio.create_task(media.run_media("ffmpeg", [], 60))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert process.killed and process.done.is_set()


async def test_stderr_retains_tail_and_nonzero_exit_fails(monkeypatch):
    process = Process(code=1, stderr=b"x" * 100000 + b"actual failure")

    async def spawn(*args, **kwargs):
        return process

    monkeypatch.setattr(media.asyncio, "create_subprocess_exec", spawn)
    with pytest.raises(media.MediaError, match="actual failure") as error:
        await media.run_media("ffmpeg", [], 60)
    assert len(str(error.value)) < 8300
