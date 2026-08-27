"""Own file-processing status selection and deterministic ARQ identities."""

from uuid import UUID

from uniffy.core.jobs import JobRef
from uniffy.core.models.files.file import (
    ExtractionStatus,
    File,
    ThumbnailStatus,
    TranscodeStatus,
)
from uniffy.domains.files.jobs.contracts import (
    EXTRACT_AUDIO_METADATA,
    EXTRACT_DOCUMENT_CONTENT,
    EXTRACT_IMAGE_METADATA,
    GENERATE_IMAGE_THUMBNAIL,
    GENERATE_PDF_THUMBNAIL,
    GENERATE_VIDEO_THUMBNAIL,
    TRANSCODE_VIDEO_TO_MP4,
)
from uniffy.domains.files.jobs.mime import (
    get_jobs_for_mime_type,
    supports_extraction,
    supports_thumbnail,
)

_THUMBNAIL_JOB_REFS = frozenset({
    GENERATE_IMAGE_THUMBNAIL,
    GENERATE_PDF_THUMBNAIL,
    GENERATE_VIDEO_THUMBNAIL,
})
_EXTRACTION_JOB_REFS = frozenset({
    EXTRACT_IMAGE_METADATA,
    EXTRACT_AUDIO_METADATA,
    EXTRACT_DOCUMENT_CONTENT,
})
_PROCESSING_JOB_REFS = _THUMBNAIL_JOB_REFS | _EXTRACTION_JOB_REFS | {TRANSCODE_VIDEO_TO_MP4}


def initial_thumbnail_status(mime_type: str) -> ThumbnailStatus:
    if supports_thumbnail(mime_type):
        return ThumbnailStatus.PENDING
    return ThumbnailStatus.SKIPPED


def initial_extraction_status(mime_type: str) -> ExtractionStatus:
    if supports_extraction(mime_type):
        return ExtractionStatus.PENDING
    return ExtractionStatus.SKIPPED


def pending_jobs_for_file(file: File) -> tuple[JobRef, ...]:
    pending: list[JobRef] = []
    for ref in get_jobs_for_mime_type(file.mime_type or ""):
        is_unfinished = (
            (
                ref in _THUMBNAIL_JOB_REFS
                and file.thumbnail_status in (ThumbnailStatus.PENDING, ThumbnailStatus.PROCESSING)
            )
            or (
                ref in _EXTRACTION_JOB_REFS
                and file.extraction_status in (ExtractionStatus.PENDING, ExtractionStatus.PROCESSING)
            )
            or (
                ref is TRANSCODE_VIDEO_TO_MP4
                and file.transcode_status in (TranscodeStatus.PENDING, TranscodeStatus.PROCESSING)
            )
        )
        if is_unfinished:
            pending.append(ref)
    return tuple(pending)


def file_processing_job_id(ref: JobRef, file_id: UUID | str, version: int) -> str:
    if ref not in _PROCESSING_JOB_REFS:
        raise ValueError(f"Job is not a file-processing ref: {ref.name}")
    return f"file-processing:{ref.name}:{file_id}:{version}"
