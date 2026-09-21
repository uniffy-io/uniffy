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


@pytest.mark.parametrize("executable", ["ffmpeg", "ffprobe"])
async def test_decoder_does_not_inherit_worker_environment(monkeypatch, executable):
    inherited = {
        "S3_SECRET_KEY",
        "POSTGRES_PASSWORD",
        "JWT_SECRET_KEY",
        "APP_MASTER_KEY",
        "UNRECOGNIZED_FUTURE_SECRET",
        "LD_PRELOAD",
        "LD_LIBRARY_PATH",
        "HTTP_PROXY",
        "http_proxy",
        "FFREPORT",
        "HOME",
    }
    for name in inherited:
        monkeypatch.setenv(name, "worker-only-sentinel")
    monkeypatch.setenv("PATH", "/untrusted-bin")
    process = Process(code=0)

    async def spawn(command, *args, env=None, **kwargs):
        assert command == executable
        assert env is not None
        assert inherited.isdisjoint(env)
        assert "worker-only-sentinel" not in env.values()
        assert "/untrusted-bin" not in env["PATH"].split(":")
        assert "/usr/local/bin" in env["PATH"].split(":")
        return process

    monkeypatch.setattr(media.asyncio, "create_subprocess_exec", spawn)
    await media.run_media(executable, [], 1)
    assert process.done.is_set()


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


@pytest.mark.parametrize("executable", ["ffmpeg", "ffprobe"])
@pytest.mark.parametrize("prefix", [b"", b"x" * 65520])
async def test_native_errors_redact_source_urls_and_tokens(monkeypatch, executable, prefix):
    token = "temporary-media-token_0123456789"
    url = f"http://127.0.0.1:43210/{token}"
    failure = f"Error opening '{url}'\nInput /{token}: Invalid data\n{url}\n".encode()
    process = Process(code=1, stderr=prefix + failure)

    async def spawn(*args, **kwargs):
        return process

    monkeypatch.setattr(media.asyncio, "create_subprocess_exec", spawn)
    with pytest.raises(media.MediaError, match="Invalid data") as error:
        await media.run_media(executable, ["-i", url], 1)
    assert url not in str(error.value)
    assert token not in str(error.value)
    assert "[media source]" in str(error.value)
    assert "[media token]" in str(error.value)
    assert len(str(error.value)) < 8300


async def test_native_errors_redact_token_when_capture_truncates_url_origin(monkeypatch):
    token = "temporary-media-token_0123456789"
    url = f"http://127.0.0.1:43210/{token}"
    failure = b"\nInvalid data"
    padding = b"x" * (8192 - len(token) - len(failure))
    process = Process(code=1, stderr=url.encode() + padding + failure)

    async def spawn(*args, **kwargs):
        return process

    monkeypatch.setattr(media.asyncio, "create_subprocess_exec", spawn)
    with pytest.raises(media.MediaError, match="Invalid data") as error:
        await media.run_media("ffprobe", [url], 1)
    assert token not in str(error.value)
    assert "[media token]" in str(error.value)


async def test_probe_scans_packets_only_when_duration_is_absent(monkeypatch):
    calls = []

    async def run(executable, args, timeout, *, stdout_line=None):
        calls.append(args)
        if stdout_line:
            for line in (
                b"pts_time=-0.007|duration_time=0.020",
                b"pts_time=2.960|duration_time=0.040",
            ):
                stdout_line(line)
            return b""
        return dumps_bytes({
            "format": {"format_name": "matroska,webm"},
            "streams": [{"codec_type": "video", "width": 640, "height": 360}],
        })

    monkeypatch.setattr(media, "run_media", run)
    info = await media.probe(Path("recording.webm"))
    assert info.duration == pytest.approx(3.007)
    assert len(calls) == 2


@pytest.mark.parametrize("timestamp", [b"nan", b"inf", b"bad", b"7201"])
async def test_packet_scan_rejects_invalid_or_excessive_timestamps(monkeypatch, timestamp):
    async def run(*args, stdout_line):
        stdout_line(b"pts_time=0|duration_time=0.040")
        stdout_line(b"pts_time=" + timestamp + b"|duration_time=0.040")

    monkeypatch.setattr(media, "run_media", run)
    with pytest.raises(media.MediaError):
        await media.packet_duration(Path("recording.webm"))


async def test_packet_scan_limit_kills_and_reaps_child(monkeypatch):
    process = Process(stdout=b"x" * 70000 + b"\n")

    async def spawn(*args, **kwargs):
        return process

    monkeypatch.setattr(media.asyncio, "create_subprocess_exec", spawn)
    with pytest.raises(media.MediaError, match="line exceeds capture limit"):
        await media.packet_duration(Path("recording.webm"))
    assert process.killed and process.done.is_set()
