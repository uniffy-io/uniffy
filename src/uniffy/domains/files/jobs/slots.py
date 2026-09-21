"""Keep encode admission within each media worker's resource budget."""

import asyncio
import os
import shutil
import tempfile
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from uniffy.domains.files.jobs.settings import MediaSettings

MEDIA_SLOTS_CTX_KEY = "media_slots"


def _available_bytes(directory: str, budget: int) -> int:
    used = 0
    for root, _, names in os.walk(directory):
        for name in names:
            try:
                used += os.stat(os.path.join(root, name), follow_symlinks=False).st_blocks * 512
            except FileNotFoundError:
                continue
    return min(budget - used, shutil.disk_usage(directory).free)


class MediaSlots:
    def __init__(self, capacity: int, settings: MediaSettings) -> None:
        self._capacity = max(1, capacity)
        self._active = 0
        self._directory = settings.scratch_directory or tempfile.gettempdir()
        self._budget = settings.scratch_max_bytes
        # FFmpeg's byte cap can overshoot by a packet and MP4 finalization metadata.
        self._reservation = settings.max_output_bytes + 256 * 1024**2
        self._headroom = 256 * 1024**2
        if self._reservation + self._headroom > self._budget:
            raise ValueError("Media scratch budget cannot fit one capped output and overhead")
        self._admission = asyncio.Lock()

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[bool]:
        if self._active >= self._capacity:
            yield False
            return
        async with self._admission:
            free = await asyncio.to_thread(_available_bytes, self._directory, self._budget)
            required = (self._active + 1) * self._reservation + self._headroom
            admitted = self._active < self._capacity and required <= free
            if admitted:
                self._active += 1
        if not admitted:
            yield False
            return
        try:
            yield True
        finally:
            self._active -= 1
