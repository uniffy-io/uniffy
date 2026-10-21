"""An upload whose uploader left its organization takes no parts and never becomes a File."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
from connectrpc.code import Code
from connectrpc.errors import ConnectError
from uniffy_proto.files.v1.files_pb import (
    CompleteUploadRequest,
    GetUploadStatusRequest,
    UploadChunkRequest,
    UploadChunksRequest,
)
from uniffy_proto.files.v1.files_pb import UploadStatus as ProtoUploadStatus

from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.files.multipart_upload import MultipartUpload, UploadStatus
from uniffy.core.storage import OBJECT_STORAGE_CTX_KEY
from uniffy.core.types import generate_id
from uniffy.domains.files.jobs import multipart
from uniffy.domains.files.operations import FileOperations
from uniffy.domains.files.rpc.uploads import UploadHandlers
from uniffy.domains.files.uploads import effective_upload_status

_UPLOADS = "uniffy.domains.files.uploads"
_RPC = "uniffy.domains.files.rpc.uploads"
_NOT_FOUND = "Upload not found"


def _upload(user_id: UUID, *, expires_in: timedelta = timedelta(hours=1)) -> MultipartUpload:
    return MultipartUpload(
        organization_id=generate_id(),
        user_id=user_id,
        s3_upload_id="s3-upload",
        storage_key="org/user/key/report.bin",
        storage_bucket="bucket",
        filename="report.bin",
        mime_type="application/octet-stream",
        total_size=4,
        total_chunks=1,
        chunk_size=4,
        status=UploadStatus.ACTIVE,
        expires_at=datetime.now(UTC) + expires_in,
    )


def _session(upload: MultipartUpload) -> MagicMock:
    session = MagicMock()
    session.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=upload))
    )
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    return session


def _storage() -> MagicMock:
    storage = MagicMock()
    storage.upload_part = AsyncMock(return_value="etag")
    storage.complete_multipart_upload = AsyncMock()
    storage.abort_multipart_upload = AsyncMock()
    return storage


def _membership(active: bool) -> AsyncMock:
    return AsyncMock(return_value=MagicMock() if active else None)


def _handlers(storage: MagicMock) -> UploadHandlers:
    handlers = UploadHandlers()
    handlers.storage = storage
    handlers.search_indexer = MagicMock()
    return handlers


@asynccontextmanager
async def _rpc(session: MagicMock, actor: UUID, *, active: bool) -> AsyncIterator[None]:
    @asynccontextmanager
    async def open_session() -> AsyncIterator[MagicMock]:
        yield session

    with (
        patch(f"{_RPC}.current_user_id", MagicMock(return_value=actor)),
        patch(f"{_RPC}.open_session", open_session),
        patch(f"{_UPLOADS}.get_active_membership", _membership(active)),
    ):
        yield


async def _refused(call: Any) -> ConnectError:
    with pytest.raises(ConnectError) as refused:
        await call
    return refused.value


async def test_complete_upload_refuses_once_the_uploader_left_the_organization() -> None:
    actor = generate_id()
    upload = _upload(actor)
    session = _session(upload)
    storage = _storage()
    membership = _membership(active=False)

    with patch(f"{_UPLOADS}.get_active_membership", membership), pytest.raises(NotFoundError):
        await FileOperations(session, storage, MagicMock()).complete_upload(upload.id, actor)

    membership.assert_awaited_once_with(session, actor, upload.organization_id)
    storage.complete_multipart_upload.assert_not_awaited()
    session.add.assert_not_called()
    session.commit.assert_not_awaited()
    assert upload.status is UploadStatus.ACTIVE


async def test_complete_upload_refuses_an_upload_that_expired_at_a_removal() -> None:
    actor = generate_id()
    upload = _upload(actor, expires_in=-timedelta(seconds=1))
    storage = _storage()

    with (
        patch(f"{_UPLOADS}.get_active_membership", _membership(active=True)),
        pytest.raises(ValidationError, match="EXPIRED"),
    ):
        await FileOperations(_session(upload), storage, MagicMock()).complete_upload(
            upload.id, actor
        )

    storage.complete_multipart_upload.assert_not_awaited()


async def test_upload_chunk_answers_not_found_after_removal() -> None:
    actor = generate_id()
    upload = _upload(actor)
    storage = _storage()
    request = UploadChunkRequest(upload_id=str(upload.id), chunk_number=1, data=b"data")

    async with _rpc(_session(upload), actor, active=False):
        error = await _refused(_handlers(storage).upload_chunk(request, MagicMock()))

    assert (error.code, error.message) == (Code.NOT_FOUND, _NOT_FOUND)
    storage.upload_part.assert_not_awaited()


async def test_upload_chunk_still_takes_parts_from_an_active_member() -> None:
    actor = generate_id()
    upload = _upload(actor)
    storage = _storage()
    request = UploadChunkRequest(upload_id=str(upload.id), chunk_number=1, data=b"data")

    async with _rpc(_session(upload), actor, active=True):
        response = await _handlers(storage).upload_chunk(request, MagicMock())

    assert response.success is True
    storage.upload_part.assert_awaited_once()


async def test_streamed_chunks_answer_not_found_after_removal() -> None:
    actor = generate_id()
    upload = _upload(actor)
    storage = _storage()

    async def chunks() -> AsyncIterator[UploadChunksRequest]:
        yield UploadChunksRequest(upload_id=str(upload.id), chunk_number=1, data=b"data")

    async with _rpc(_session(upload), actor, active=False):
        error = await _refused(_handlers(storage).upload_chunks(chunks(), MagicMock()))

    assert (error.code, error.message) == (Code.NOT_FOUND, _NOT_FOUND)
    storage.upload_part.assert_not_awaited()


async def test_upload_status_answers_not_found_after_removal() -> None:
    actor = generate_id()
    upload = _upload(actor)
    session = _session(upload)
    request = GetUploadStatusRequest(upload_id=str(upload.id))

    async with _rpc(session, actor, active=False):
        error = await _refused(_handlers(_storage()).get_upload_status(request, MagicMock()))

    assert (error.code, error.message) == (Code.NOT_FOUND, _NOT_FOUND)
    session.execute.assert_awaited_once()


async def test_upload_status_of_a_readded_member_reports_the_expiry_of_the_removal() -> None:
    actor = generate_id()
    upload = _upload(actor, expires_in=-timedelta(seconds=1))
    request = GetUploadStatusRequest(upload_id=str(upload.id))

    async with _rpc(_session(upload), actor, active=True):
        response = await _handlers(_storage()).get_upload_status(request, MagicMock())

    assert response.status == ProtoUploadStatus.EXPIRED
    assert upload.status is UploadStatus.ACTIVE


async def test_complete_upload_rpc_answers_not_found_after_removal() -> None:
    actor = generate_id()
    upload = _upload(actor)
    storage = _storage()
    request = CompleteUploadRequest(upload_id=str(upload.id))

    async with _rpc(_session(upload), actor, active=False):
        error = await _refused(_handlers(storage).complete_upload(request, MagicMock()))

    assert (error.code, error.message) == (Code.NOT_FOUND, _NOT_FOUND)
    storage.complete_multipart_upload.assert_not_awaited()


def test_an_active_row_past_its_expiry_counts_as_expired() -> None:
    owner = generate_id()

    assert effective_upload_status(_upload(owner)) is UploadStatus.ACTIVE
    assert (
        effective_upload_status(_upload(owner, expires_in=-timedelta(seconds=1)))
        is UploadStatus.EXPIRED
    )
    aborted = _upload(owner, expires_in=-timedelta(seconds=1))
    aborted.status = UploadStatus.ABORTED
    assert effective_upload_status(aborted) is UploadStatus.ABORTED


async def test_the_reaper_aborts_the_storage_parts_of_an_upload_expired_at_a_removal() -> None:
    upload = _upload(generate_id(), expires_in=-timedelta(seconds=1))
    expired = MagicMock()
    expired.scalars.return_value.all.return_value = [upload]
    stale = MagicMock()
    stale.scalars.return_value.all.return_value = []
    session = MagicMock()
    session.execute = AsyncMock(side_effect=[expired, stale])
    session.commit = AsyncMock()
    storage = _storage()

    @asynccontextmanager
    async def open_session() -> AsyncIterator[MagicMock]:
        yield session

    with (
        patch.object(multipart, "_acquire_lock", AsyncMock(return_value="lock")),
        patch.object(multipart, "_release_lock", AsyncMock()),
        patch.object(multipart, "open_session", open_session),
    ):
        result = await multipart.reap_expired_multipart_uploads({OBJECT_STORAGE_CTX_KEY: storage})

    assert result["status"] == "success"
    storage.abort_multipart_upload.assert_awaited_once_with(
        key=upload.storage_key, upload_id=upload.s3_upload_id
    )
    assert upload.status is UploadStatus.EXPIRED
