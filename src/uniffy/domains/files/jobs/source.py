"""Expose claimed object bytes to native decoders without local source copies."""

import asyncio
import secrets
from collections.abc import AsyncIterator
from contextlib import aclosing, asynccontextmanager
from dataclasses import dataclass, field

from aiohttp import web

from uniffy.core.storage import ObjectStorage
from uniffy.domains.files.jobs.media import MediaError, MediaSource

MEDIA_SOURCE_CTX_KEY = "media_source"
_CHUNK_BYTES = 64 * 1024


@dataclass
class _Object:
    key: str
    size: int
    etag: str
    tasks: set[asyncio.Task] = field(default_factory=set)
    error: Exception | None = None


class MediaSourceServer:
    def __init__(self, storage: ObjectStorage) -> None:
        self._storage = storage
        self._objects: dict[str, _Object] = {}
        self._runner: web.AppRunner | None = None
        self._origin = ""

    async def startup(self) -> None:
        app = web.Application(client_max_size=1024)
        app.router.add_get("/{token}", self._serve)
        runner = web.AppRunner(
            app,
            access_log=None,
            handler_cancellation=True,
            shutdown_timeout=5,
            max_line_size=4096,
            max_field_size=4096,
        )
        await runner.setup()
        try:
            await web.TCPSite(runner, "127.0.0.1", 0).start()
        except BaseException:
            await runner.cleanup()
            raise
        self._runner = runner
        self._origin = f"http://127.0.0.1:{runner.addresses[0][1]}"

    async def shutdown(self) -> None:
        if self._runner is not None:
            await self._runner.cleanup()
            self._runner = None
        self._objects.clear()

    @asynccontextmanager
    async def open(self, key: str, limit: int) -> AsyncIterator[MediaSource]:
        if self._runner is None:
            raise RuntimeError("Media source server is not running")
        async with asyncio.timeout(30):
            metadata = await self._storage.get_object_info(key)
        size = int(metadata.get("ContentLength", 0))
        if not 0 < size <= limit:
            raise MediaError("Video exceeds source size limit or is empty")
        etag = metadata.get("ETag")
        if not isinstance(etag, str) or not etag:
            raise MediaError("Video source has no object identity")
        token = secrets.token_urlsafe(32)
        source = _Object(key, size, etag)
        self._objects[token] = source
        try:
            try:
                yield MediaSource(f"{self._origin}/{token}")
            except MediaError:
                if source.error is not None:
                    raise source.error from None
                raise
            if source.error is not None:
                raise source.error
        finally:
            self._objects.pop(token, None)
            tasks = tuple(source.tasks)
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _serve(self, request: web.Request) -> web.StreamResponse:
        source = self._objects.get(request.match_info["token"])
        if (
            source is None
            or request.query_string
            or request.host != self._origin.removeprefix("http://")
        ):
            raise web.HTTPNotFound()
        if request.content_length or request.headers.get("Transfer-Encoding"):
            raise web.HTTPBadRequest()
        try:
            ranges = request.headers.getall("Range", [])
            if len(ranges) > 1 or (
                ranges and ranges[0].startswith("bytes=-") and int(ranges[0][7:]) == 0
            ):
                raise ValueError("Unsatisfiable range")
            span = request.http_range
            start, stop = span.start, span.stop
            if start is None:
                start = 0
            elif start < 0:
                start = max(0, source.size + start)
            stop = min(stop, source.size) if stop is not None else source.size
            if start >= stop:
                raise ValueError("Unsatisfiable range")
        except ValueError:
            raise web.HTTPRequestRangeNotSatisfiable(
                headers={"Content-Range": f"bytes */{source.size}"}
            ) from None
        partial = bool(ranges)
        headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": str(stop - start),
            "Content-Type": "application/octet-stream",
            "Cache-Control": "no-store",
            "ETag": source.etag,
        }
        if partial:
            headers["Content-Range"] = f"bytes {start}-{stop - 1}/{source.size}"
        response = web.StreamResponse(status=206 if partial else 200, headers=headers)
        response.force_close()
        if request.method == "HEAD":  # noqa: PLR2004 - HTTP method.
            return response
        if len(source.tasks) >= 2:
            raise web.HTTPServiceUnavailable()
        task = asyncio.current_task()
        assert task is not None
        source.tasks.add(task)
        try:
            stream = self._storage.download_range(
                source.key, start, stop - 1, chunk_size=_CHUNK_BYTES, etag=source.etag
            )
            remaining = stop - start
            async with aclosing(stream):
                while remaining:
                    try:
                        async with asyncio.timeout(30):
                            chunk, size, first, last = await anext(stream)
                    except StopAsyncIteration:
                        raise OSError("Video source Range read ended early") from None
                    if (size, first, last) != (source.size, start, stop - 1) or not 0 < len(
                        chunk
                    ) <= min(_CHUNK_BYTES, remaining):
                        raise MediaError("Video source changed during Range read")
                    try:
                        if not response.prepared:
                            await response.prepare(request)
                        async with asyncio.timeout(30):
                            await response.write(chunk)
                    except ConnectionResetError, BrokenPipeError:
                        return response
                    remaining -= len(chunk)
            return response
        except Exception as error:
            source.error = error
            if response.prepared:
                if request.transport is not None:
                    request.transport.close()
                return response
            raise web.HTTPBadGateway() from None
        finally:
            source.tasks.discard(task)
