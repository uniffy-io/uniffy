from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock

import pytest

from uniffy.core.jobs import JobRef
from uniffy.core.models.files.file import (
    ExtractionStatus,
    File,
    ThumbnailStatus,
    TranscodeStatus,
)
from uniffy.core.types import generate_id
from uniffy.domains.files.jobs import recovery
from uniffy.domains.files.jobs.contracts import (
    EXTRACT_DOCUMENT_CONTENT,
    GENERATE_PDF_THUMBNAIL,
)
from uniffy.domains.files.jobs.mime import get_jobs_for_mime_type
from uniffy.domains.files.jobs.processing import (
    file_processing_job_id,
    pending_jobs_for_file,
)
from uniffy.domains.files.operations import FileOperations


class _Result:
    def __init__(self, rows: list[File]) -> None:
        self._rows = rows

    def scalars(self) -> "_Result":
        return self

    def all(self) -> list[File]:
        return self._rows


class _Session:
    def __init__(self, rows: list[File]) -> None:
        self._rows = rows

    async def execute(self, _statement) -> _Result:
        return _Result(self._rows)


class _SessionContext:
    def __init__(self, rows: list[File]) -> None:
        self._session = _Session(rows)

    async def __aenter__(self) -> _Session:
        return self._session

    async def __aexit__(self, *_args: object) -> None:
        return None


def _pending_file(mime_type: str = "image/jpeg") -> File:
    old = datetime.now(UTC) - timedelta(minutes=10)
    return File(
        organization_id=generate_id(),
        owner_id=generate_id(),
        filename="photo.jpg",
        original_filename="photo.jpg",
        mime_type=mime_type,
        size_bytes=10,
        storage_key="test/photo.jpg",
        storage_bucket="test",
        extraction_status=ExtractionStatus.PENDING,
        thumbnail_status=ThumbnailStatus.PENDING,
        transcode_status=TranscodeStatus.NOT_NEEDED,
        created_at=old,
        updated_at=old,
    )


async def test_pending_file_is_recovered_after_initial_enqueue_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    file = _pending_file()
    initial_enqueue = AsyncMock(side_effect=RuntimeError("queue unavailable"))
    monkeypatch.setattr("uniffy.domains.files.operations.enqueue_job", initial_enqueue)

    operations = FileOperations.__new__(FileOperations)
    await operations._enqueue_processing_jobs(file)

    queue = AsyncMock()
    monkeypatch.setattr(recovery, "open_session", lambda: _SessionContext([file]))
    result = await recovery.recover_pending_file_processing({"valkey": queue})

    expected_refs = get_jobs_for_mime_type(file.mime_type)
    assert initial_enqueue.await_count == 1
    assert file.extraction_status == ExtractionStatus.PENDING
    assert result == {
        "status": "complete",
        "scanned": 1,
        "enqueued": len(expected_refs),
        "deduplicated": 0,
        "failed": 0,
    }
    assert [call.args[0] for call in queue.enqueue_job.await_args_list] == [
        ref.name for ref in expected_refs
    ]
    assert all(
        call.args[1:3] == (str(file.id), str(file.organization_id))
        for call in queue.enqueue_job.await_args_list
    )
    assert [call.kwargs["_job_id"] for call in queue.enqueue_job.await_args_list] == [
        file_processing_job_id(ref, file.id, file.version) for ref in expected_refs
    ]


async def test_recovery_queues_only_the_transcode_still_pending(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    file = _pending_file()
    file.mime_type = "video/webm"
    file.thumbnail_status = ThumbnailStatus.COMPLETED
    file.extraction_status = ExtractionStatus.COMPLETED
    file.transcode_status = TranscodeStatus.PENDING
    queue = AsyncMock()
    monkeypatch.setattr(recovery, "open_session", lambda: _SessionContext([file]))

    result = await recovery.recover_pending_file_processing({"valkey": queue})

    assert result["enqueued"] == 1
    queue.enqueue_job.assert_awaited_once()


def test_thumbnail_completion_does_not_hide_pending_document_extraction() -> None:
    file = _pending_file("application/pdf")
    file.thumbnail_status = ThumbnailStatus.COMPLETED
    file.extraction_status = ExtractionStatus.PROCESSING

    assert pending_jobs_for_file(file) == (EXTRACT_DOCUMENT_CONTENT,)

    file.thumbnail_status = ThumbnailStatus.PROCESSING
    file.extraction_status = ExtractionStatus.COMPLETED

    assert pending_jobs_for_file(file) == (GENERATE_PDF_THUMBNAIL,)


class _DeduplicatingQueue:
    def __init__(self) -> None:
        self.job_ids: set[str] = set()
        self.attempted_job_ids: list[str] = []

    async def enqueue_job(
        self,
        _name: str,
        *_args: Any,
        _job_id: str,
        **_kwargs: Any,
    ) -> object | None:
        self.attempted_job_ids.append(_job_id)
        if _job_id in self.job_ids:
            return None
        self.job_ids.add(_job_id)
        return object()


async def test_recovery_deduplicates_against_the_initial_enqueue(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    file = _pending_file("application/pdf")
    queue = _DeduplicatingQueue()

    async def enqueue_through_queue(
        ref: JobRef,
        *args: Any,
        **kwargs: Any,
    ) -> object | None:
        return await queue.enqueue_job(ref.name, *args, **kwargs)

    monkeypatch.setattr("uniffy.domains.files.operations.enqueue_job", enqueue_through_queue)
    operations = FileOperations.__new__(FileOperations)
    await operations._enqueue_processing_jobs(file)

    initially_enqueued = set(queue.job_ids)
    monkeypatch.setattr(recovery, "open_session", lambda: _SessionContext([file]))
    result = await recovery.recover_pending_file_processing({"valkey": queue})

    expected_refs = get_jobs_for_mime_type(file.mime_type)
    assert len(initially_enqueued) == len(expected_refs)
    assert queue.job_ids == initially_enqueued
    assert result["enqueued"] == 0
    assert result["deduplicated"] == len(expected_refs)
