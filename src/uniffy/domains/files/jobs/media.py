"""Bounded local media probing and encoding."""

import asyncio
import math
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from uniffy.core.json_codec import loads
from uniffy.domains.files.jobs.settings import MEDIA_SETTINGS, MediaSettings


class MediaError(RuntimeError):
    pass


class MissingDurationError(MediaError):
    pass


async def run_media(
    executable: str,
    args: list[str],
    timeout: float,
    *,
    stdout_line: Callable[[bytes], None] | None = None,
) -> bytes:
    if executable not in {"ffmpeg", "ffprobe"}:
        raise ValueError("Unsupported media executable")
    proc = await asyncio.create_subprocess_exec(
        executable, *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )

    async def read_bounded(stream: asyncio.StreamReader, limit: int, tail: bool) -> bytes:
        data = bytearray()
        while chunk := await stream.read(65536):
            data.extend(chunk)
            if len(data) > limit:
                if not tail:
                    raise MediaError("Media output exceeds capture limit")
                del data[:-limit]
        return bytes(data)

    async def read_lines(stream: asyncio.StreamReader) -> bytes:
        size = 0
        while True:
            try:
                line = await stream.readline()
            except ValueError as exc:
                raise MediaError("Media metadata line exceeds capture limit") from exc
            if not line:
                return b""
            size += len(line)
            if size > 64 * 1024**2:
                raise MediaError("Media metadata exceeds capture limit")
            assert stdout_line is not None
            stdout_line(line)

    try:
        async with asyncio.timeout(timeout):
            try:
                async with asyncio.TaskGroup() as group:
                    output = group.create_task(
                        read_lines(proc.stdout)
                        if stdout_line is not None
                        else read_bounded(proc.stdout, 2 * 1024**2, False)
                    )
                    errors = group.create_task(read_bounded(proc.stderr, 8192, True))
                    group.create_task(proc.wait())
            except* MediaError as exc:
                raise exc.exceptions[0] from None
        if proc.returncode:
            raise MediaError(f"{executable} failed: {errors.result().decode(errors='replace')}")
        return output.result()
    finally:
        if proc.returncode is None:
            proc.kill()
        await proc.wait()


@dataclass(frozen=True)
class ProbeResult:
    container: str
    duration: float
    videos: tuple[dict[str, Any], ...]
    audio: tuple[dict[str, Any], ...]

    @property
    def video(self) -> dict[str, Any]:
        return self.videos[0]

    @property
    def hdr(self) -> bool:
        return self.video.get("color_transfer") in {"smpte2084", "arib-std-b67"}


def parse_probe(data: bytes, *, duration: float | None = None) -> ProbeResult:
    value = loads(data)
    streams = value.get("streams", [])
    videos = tuple(
        s
        for s in streams
        if s.get("codec_type") == "video"  # noqa: PLR2004 - ffprobe stream type.
        and not s.get("disposition", {}).get("attached_pic")
    )
    audio = tuple(s for s in streams if s.get("codec_type") == "audio")  # noqa: PLR2004 - ffprobe type.
    if not videos:
        raise MediaError("Video has no usable video stream")
    for video in videos:
        if (
            not 0 < int(video.get("width", 0)) <= 16384
            or not 0 < int(video.get("height", 0)) <= 16384
        ):
            raise MediaError("Video dimensions exceed decoder limit")
    if duration is None:
        raw_duration = value.get("format", {}).get("duration")
        if raw_duration in (None, "N/A"):
            raise MissingDurationError("Video has no indexed duration")
        try:
            duration = float(raw_duration)
        except TypeError, ValueError:
            raise MediaError("Video has no usable duration") from None
    if not math.isfinite(duration) or duration <= 0:
        raise MediaError("Video has no usable duration")
    return ProbeResult(value.get("format", {}).get("format_name", ""), duration, videos, audio)


async def probe(path: Path) -> ProbeResult:
    data = await run_media(
        "ffprobe",
        [
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-show_format",
            "-show_streams",
            "-print_format",
            "json",
            str(path),
        ],
        30,
    )
    try:
        return parse_probe(data)
    except MissingDurationError:
        return parse_probe(data, duration=await packet_duration(path))


async def packet_duration(path: Path) -> float:
    first: float | None = None
    last: float | None = None

    def visit(line: bytes) -> None:
        nonlocal first, last
        fields = dict(part.split(b"=", 1) for part in line.strip().split(b"|") if b"=" in part)
        if fields.get(b"pts_time") in (None, b"N/A"):
            return
        try:
            timestamp = float(fields[b"pts_time"])
            raw_duration = fields.get(b"duration_time", b"0")
            duration = 0.0 if raw_duration == b"N/A" else float(raw_duration)
        except ValueError:
            raise MediaError("Video has invalid packet timestamps") from None
        if not math.isfinite(timestamp) or not math.isfinite(duration) or duration < 0:
            raise MediaError("Video has invalid packet timestamps")
        first = timestamp if first is None else min(first, timestamp)
        last = timestamp + duration if last is None else max(last, timestamp + duration)
        if last - first > MEDIA_SETTINGS.max_duration_seconds:
            raise MediaError("Video duration exceeds processing limit")

    await run_media(
        "ffprobe",
        [
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-show_entries",
            "packet=pts_time,duration_time",
            "-of",
            "compact=p=0",
            str(path),
        ],
        30,
        stdout_line=visit,
    )
    if first is None or last is None or last <= first:
        raise MediaError("Video has no usable duration")
    return last - first


def is_web_safe(info: ProbeResult) -> bool:
    return (
        "mov" in info.container.split(",")  # noqa: PLR2004 - ffprobe container.
        and len(info.videos) == 1
        and info.video.get("codec_name") == "h264"  # noqa: PLR2004 - codec name.
        and info.video.get("profile") in {"Constrained Baseline", "Baseline", "Main", "High"}
        and info.video.get("pix_fmt") in {"yuv420p", "yuvj420p"}
        and max(int(info.video["width"]), int(info.video["height"])) <= 4096
        and not info.hdr
        and all(s.get("codec_name") == "aac" and s.get("profile") == "LC" for s in info.audio)  # noqa: PLR2004 - ffprobe audio.
    )


def video_filter(info: ProbeResult, width: int, height: int) -> str:
    filters = []
    if info.hdr:
        if info.video.get("color_primaries") != "bt2020":  # noqa: PLR2004 - color primaries.
            raise MediaError("Unsupported HDR color primaries")
        filters.extend([
            "zscale=t=linear:npl=100",
            "format=gbrpf32le",
            "zscale=p=bt709",
            "tonemap=tonemap=hable:desat=0",
            "zscale=t=bt709:m=bt709:r=tv",
        ])
    filters.append(
        f"scale=w='min({width},iw)':h='min({height},ih)':"
        "force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1"
    )
    return ",".join(filters)


def rendition_args(src: Path, output: Path, info: ProbeResult, settings: MediaSettings) -> list[str]:
    return [
        "-y",
        "-nostdin",
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-threads",
        str(settings.threads),
        "-i",
        str(src),
        "-map",
        "0:V:0",
        "-map",
        "0:a:0?",
        "-sn",
        "-dn",
        "-vf",
        video_filter(info, 1920, 1080),
        "-filter_threads",
        "1",
        "-c:v",
        "libx264",
        "-threads",
        str(settings.threads),
        "-profile:v",
        "high",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ac",
        "2",
        "-movflags",
        "+faststart",
        "-fs",
        str(settings.max_output_bytes),
        str(output),
    ]


def thumbnail_args(src: Path, info: ProbeResult) -> list[str]:
    return [
        "-nostdin",
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-threads",
        "1",
        "-i",
        str(src),
        "-map",
        "0:V:0",
        "-an",
        "-sn",
        "-dn",
        "-frames:v",
        "1",
        "-vf",
        video_filter(info, 400, 400),
        "-filter_threads",
        "1",
        "-c:v",
        "png",
        "-threads",
        "1",
        "-f",
        "image2pipe",
        "pipe:1",
    ]
