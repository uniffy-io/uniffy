from contextlib import asynccontextmanager
from unittest.mock import AsyncMock
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.files.file import PlaybackStatus, TranscodeStatus
from uniffy.core.types import generate_id
from uniffy.domains.files import routes


@pytest.fixture
def route_file(monkeypatch):
    file = SimpleNamespace(
        storage_key="original",
        mime_type="video/quicktime",
        version=2,
        filename="clip.mov",
        playback_version=2,
        playback_key="copy",
        playback_status=PlaybackStatus.COMPLETED,
        transcode_status=TranscodeStatus.PROCESSING,
    )

    @asynccontextmanager
    async def session():
        yield object()

    monkeypatch.setattr(routes, "open_session", session)
    get_file = AsyncMock(return_value=file)
    monkeypatch.setattr(routes, "FileOperations", lambda *args: SimpleNamespace(get_by_id=get_file))
    return file, get_file


async def test_original_is_not_blocked_during_recording_swap(route_file):
    storage = AsyncMock()
    storage.get_object_info.return_value = {"ContentLength": 20}
    response = await routes.stream_media(storage, generate_id(), generate_id(), generate_id())
    assert response.status_code == 200
    assert response.headers["content-type"] == "video/mp4"
    assert response.headers["cache-control"] == "private, no-store"
    storage.get_object_info.assert_awaited_once_with("original")


async def test_fallback_range_streams_copy_after_permission_gate(route_file):
    file, gate = route_file
    storage = AsyncMock()
    storage.get_object_info.return_value = {"ContentLength": 20}
    seen = []

    async def stream(**kwargs):
        seen.append(kwargs)
        yield b"abcd", 20, 2, 5

    storage.download_range = stream
    org, file_id, user = generate_id(), generate_id(), generate_id()
    response = await routes.stream_media(
        storage, org, file_id, user, "bytes=2-5", playback_version=2
    )
    assert response.status_code == 206
    assert response.headers["content-range"] == "bytes 2-5/20"
    assert b"".join([chunk async for chunk in response.body_iterator]) == b"abcd"
    assert seen == [{"key": "copy", "start_byte": 2, "end_byte": 5}]
    gate.assert_awaited_once_with(user, org, file_id)


@pytest.mark.parametrize(
    "version,state", [(1, PlaybackStatus.COMPLETED), (2, PlaybackStatus.PROCESSING)]
)
async def test_stale_and_unpublished_copy_returns_404(route_file, version, state):
    route_file[0].playback_status = state
    storage = AsyncMock()
    with pytest.raises(HTTPException) as error:
        await routes.stream_media(
            storage, generate_id(), generate_id(), generate_id(), playback_version=version
        )
    assert error.value.status_code == 404
    storage.get_object_info.assert_not_called()


async def test_permission_denial_prevents_storage_access(route_file):
    route_file[1].side_effect = PermissionDeniedError("Denied")
    storage = AsyncMock()
    with pytest.raises(HTTPException) as error:
        await routes.stream_media(
            storage, generate_id(), generate_id(), generate_id(), playback_version=2
        )
    assert error.value.status_code == 403
    storage.get_object_info.assert_not_called()
