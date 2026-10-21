"""The wire upload status counts an ACTIVE row past its expiry as EXPIRED, like every write path."""

from datetime import UTC, datetime, timedelta

import pytest
from uniffy_proto.files.v1.files_pb import UploadStatus as ProtoUploadStatus

from uniffy.core.models.files.multipart_upload import MultipartUpload, UploadStatus
from uniffy.core.types import generate_id
from uniffy.domains.files.converters import upload_to_proto_status


def _upload(status: UploadStatus, *, expires_in: timedelta) -> MultipartUpload:
    return MultipartUpload(
        organization_id=generate_id(),
        user_id=generate_id(),
        s3_upload_id="s3-upload",
        storage_key="org/user/key/report.bin",
        storage_bucket="bucket",
        filename="report.bin",
        mime_type="application/octet-stream",
        total_size=4,
        total_chunks=1,
        chunk_size=4,
        status=status,
        expires_at=datetime.now(UTC) + expires_in,
    )


def test_an_active_row_past_its_expiry_reports_expired() -> None:
    upload = _upload(UploadStatus.ACTIVE, expires_in=-timedelta(seconds=1))

    assert upload_to_proto_status(upload) == ProtoUploadStatus.EXPIRED


def test_an_active_row_before_its_expiry_reports_active() -> None:
    upload = _upload(UploadStatus.ACTIVE, expires_in=timedelta(hours=1))

    assert upload_to_proto_status(upload) == ProtoUploadStatus.ACTIVE


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (UploadStatus.COMPLETED, ProtoUploadStatus.COMPLETED),
        (UploadStatus.ABORTED, ProtoUploadStatus.ABORTED),
        (UploadStatus.EXPIRED, ProtoUploadStatus.EXPIRED),
    ],
)
def test_a_settled_row_keeps_its_status_past_its_expiry(
    status: UploadStatus, expected: ProtoUploadStatus
) -> None:
    upload = _upload(status, expires_in=-timedelta(seconds=1))

    assert upload_to_proto_status(upload) == expected
