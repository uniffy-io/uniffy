"""Bounded local media probing and encoding."""

import asyncio
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from uniffy.core.json_codec import loads
from uniffy.domains.files.jobs.settings import MediaSettings


class MediaError(RuntimeError):
    pass


async def run_media(executable: str, args: list[str], timeout: float) -> bytes:
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

    try:
        async with asyncio.timeout(timeout):
            async with asyncio.TaskGroup() as group:
                output = group.create_task(read_bounded(proc.stdout, 2 * 1024**2, False))
                errors = group.create_task(read_bounded(proc.stderr, 8192, True))
                group.create_task(proc.wait())
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


def parse_probe(data: bytes) -> ProbeResult:
    value = loads(data)
    streams = value.get("streams", [])
    videos = tuple(
        s
        for s in streams
        if s.get("codec_type") == "video"  # noqa: PLR2004 - ffprobe stream type.
        and not s.get("disposition", {}).get("attached_pic")
    )
    audio = tuple(s for s in streams if s.get("codec_type") == "audio")  # noqa: PLR2004 - ffprobe type.
    try:
        duration = float(value.get("format", {}).get("duration", 0))
    except TypeError, ValueError:
        duration = 0
    if not videos or not math.isfinite(duration) or duration <= 0:
        raise MediaError("Video has no usable duration or video stream")
    for video in videos:
        if (
            not 0 < int(video.get("width", 0)) <= 16384
            or not 0 < int(video.get("height", 0)) <= 16384
        ):
            raise MediaError("Video dimensions exceed decoder limit")
    return ProbeResult(value.get("format", {}).get("format_name", ""), duration, videos, audio)


async def probe(path: Path) -> ProbeResult:
    return parse_probe(
        await run_media(
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
    )


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
