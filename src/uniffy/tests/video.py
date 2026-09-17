import asyncio
from pathlib import Path


async def _encode(*args: str) -> None:
    process = await asyncio.create_subprocess_exec(
        "ffmpeg-fixtures",
        "-nostdin",
        "-y",
        "-v",
        "error",
        *args,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        _, stderr = await asyncio.wait_for(process.communicate(), timeout=60)
    except BaseException:
        if process.returncode is None:
            process.kill()
        await process.wait()
        raise
    if process.returncode:
        raise RuntimeError(stderr[-8192:].decode(errors="replace"))


async def make_videos(directory: Path) -> Path:
    source = str(directory / "h264.mov")
    await _encode(
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=192x108:rate=30",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000",
        "-t",
        "1",
        "-c:v",
        "libx264",
        "-threads",
        "2",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        source,
    )
    await _encode(
        "-i",
        source,
        "-c:v",
        "libx265",
        "-preset",
        "ultrafast",
        "-x265-params",
        "pools=1:frame-threads=1:log-level=error",
        "-c:a",
        "copy",
        str(directory / "hevc.mp4"),
    )
    await _encode(
        "-i",
        source,
        "-c:v",
        "libvpx-vp9",
        "-threads",
        "2",
        "-c:a",
        "libopus",
        str(directory / "vp9.webm"),
    )
    await _encode(
        "-i",
        source,
        "-c:v",
        "libaom-av1",
        "-cpu-used",
        "8",
        "-threads",
        "2",
        "-an",
        str(directory / "av1.mkv"),
    )
    await _encode(
        "-display_rotation:v:0",
        "90",
        "-i",
        source,
        "-c",
        "copy",
        str(directory / "rotated.mp4"),
    )
    await _encode(
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=193x109:rate=5",
        "-t",
        "0.4",
        "-c:v",
        "libvpx-vp9",
        "-threads",
        "2",
        "-pix_fmt",
        "yuv444p",
        str(directory / "odd.webm"),
    )
    await _encode(
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=2048x1152:rate=5",
        "-t",
        "0.4",
        "-c:v",
        "libx264",
        "-threads",
        "2",
        "-pix_fmt",
        "yuv420p",
        str(directory / "large.mp4"),
    )
    await _encode(
        "-i",
        source,
        "-c:v",
        "libx265",
        "-pix_fmt",
        "yuv420p10le",
        "-preset",
        "ultrafast",
        "-x265-params",
        "pools=1:frame-threads=1:log-level=error:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc",
        "-color_primaries",
        "bt2020",
        "-color_trc",
        "smpte2084",
        "-colorspace",
        "bt2020nc",
        "-an",
        str(directory / "hdr.mp4"),
    )
    return directory
