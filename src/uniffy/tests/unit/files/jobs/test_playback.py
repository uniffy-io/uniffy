from unittest.mock import AsyncMock

import pytest

from uniffy.core.models.files.file import File, PlaybackStatus, TranscodeStatus
from uniffy.core.types import generate_id
from uniffy.domains.files.converters import PLAYBACK_STATUS_TO_PROTO
from uniffy.domains.files.jobs.contracts import GENERATE_PLAYBACK_RENDITION
from uniffy.domains.files.jobs.playback import PlaybackClaim, matches_claim
from uniffy.domains.files.jobs.processing import (
    initial_playback_status,
    pending_jobs_for_file,
    reset_playback,
)
from uniffy.domains.files.jobs.scratch import download_source, upload_video


def example_file():
    return File(
        id=generate_id(),
        organization_id=generate_id(),
        owner_id=generate_id(),
        filename="clip.mov",
        original_filename="clip.mov",
        mime_type="video/quicktime",
        size_bytes=10,
        storage_key="original",
        storage_bucket="bucket",
        version=1,
        playback_key="copy",
        playback_version=1,
        playback_status=PlaybackStatus.PROCESSING,
    )


@pytest.mark.parametrize("change", ["version", "source", "attempt", "deleted", "org", "status"])
def test_stale_claim_cannot_publish_or_fail_changed_file(change):
    file = example_file()
    claim = PlaybackClaim(file.id, file.organization_id, file.owner_id, 1, "original", "copy", 10, 1)
    assert matches_claim(file, claim)
    if change == "version":
        file.version = 2
    elif change == "source":
        file.storage_key = "replacement"
    elif change == "attempt":
        file.playback_key = "another-copy"
    elif change == "deleted":
        file.is_deleted = True
    elif change == "org":
        file.organization_id = generate_id()
    else:
        file.playback_status = PlaybackStatus.COMPLETED
    assert not matches_claim(file, claim)


def test_reset_and_recovery_include_playback():
    file = example_file()
    reset_playback(file)
    assert file.playback_status == PlaybackStatus.PENDING
    assert file.playback_key is None and file.playback_attempts == 0
    assert GENERATE_PLAYBACK_RENDITION in pending_jobs_for_file(file)
    file.playback_status = PlaybackStatus.PROCESSING
    assert GENERATE_PLAYBACK_RENDITION in pending_jobs_for_file(file)
    assert (
        initial_playback_status("video/webm", TranscodeStatus.PENDING) == PlaybackStatus.NOT_NEEDED
    )


def test_playback_status_proto_mapping_is_total():
    assert set(PLAYBACK_STATUS_TO_PROTO) == set(PlaybackStatus)


async def test_oversized_source_is_rejected_before_download(tmp_path):
    storage = AsyncMock()
    storage.get_object_info.return_value = {"ContentLength": 101}
    with pytest.raises(RuntimeError, match="size limit"):
        await download_source(storage, "key", tmp_path / "input", 100)
    storage.download_stream.assert_not_called()


async def test_failed_upload_aborts_multipart(tmp_path):
    path = tmp_path / "output.mp4"
    path.write_bytes(b"video")
    storage = AsyncMock()
    storage.create_multipart_upload.return_value = "multipart"
    storage.upload_part.side_effect = OSError("unavailable")
    record = AsyncMock()
    with pytest.raises(OSError):
        await upload_video(storage, "output", path, record)
    record.assert_awaited_once_with("multipart")
    storage.abort_multipart_upload.assert_awaited_once_with("output", "multipart")
    storage.complete_multipart_upload.assert_not_called()
