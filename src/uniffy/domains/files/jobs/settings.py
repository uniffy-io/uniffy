"""Finite resource budgets for media processing."""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class MediaSettings:
    enabled: bool = True
    max_concurrent: int = 1
    max_source_bytes: int = 4 * 1024**3
    max_output_bytes: int = 4 * 1024**3
    max_duration_seconds: int = 7200
    timeout_floor: int = 1800
    threads: int = 2
    scratch_directory: str | None = None

    @property
    def job_timeout(self) -> int:
        return max(self.timeout_floor, self.max_duration_seconds * 4) + 600

    @classmethod
    def from_env(cls) -> MediaSettings:
        concurrency = max(1, int(os.getenv("TRANSCODE_MAX_CONCURRENT", "1")))
        media_capacity = max(1, int(os.getenv("MEDIA_WORKER_MAX_JOBS", "2")))
        return cls(
            enabled=os.getenv("MEDIA_RENDITIONS_ENABLED", "true").lower() in {"true", "1", "yes"},
            max_concurrent=min(concurrency, media_capacity),
            max_source_bytes=max(1, int(os.getenv("TRANSCODE_MAX_SOURCE_BYTES", str(4 * 1024**3)))),
            max_output_bytes=max(1, int(os.getenv("TRANSCODE_MAX_OUTPUT_BYTES", str(4 * 1024**3)))),
            max_duration_seconds=max(1, int(os.getenv("TRANSCODE_MAX_DURATION_SECONDS", "7200"))),
            timeout_floor=max(1, int(os.getenv("TRANSCODE_FFMPEG_TIMEOUT", "1800"))),
            threads=max(1, int(os.getenv("TRANSCODE_THREADS", "2"))),
            scratch_directory=os.getenv("MEDIA_SCRATCH_DIRECTORY") or None,
        )


MEDIA_SETTINGS = MediaSettings.from_env()
