"""MIME type to background-job mapping for thumbnails, transcode, and extraction."""

from uniffy.core.jobs import JobRef
from uniffy.domains.files.jobs.contracts import (
    EXTRACT_AUDIO_METADATA,
    EXTRACT_DOCUMENT_CONTENT,
    EXTRACT_IMAGE_METADATA,
    GENERATE_IMAGE_THUMBNAIL,
    GENERATE_PDF_THUMBNAIL,
    GENERATE_VIDEO_THUMBNAIL,
    TRANSCODE_VIDEO_TO_MP4,
)

THUMBNAIL_MIME_TYPES: dict[str, JobRef] = {
    "image/jpeg": GENERATE_IMAGE_THUMBNAIL,
    "image/png": GENERATE_IMAGE_THUMBNAIL,
    "image/gif": GENERATE_IMAGE_THUMBNAIL,
    "image/webp": GENERATE_IMAGE_THUMBNAIL,
    "image/bmp": GENERATE_IMAGE_THUMBNAIL,
    "image/tiff": GENERATE_IMAGE_THUMBNAIL,
    "application/pdf": GENERATE_PDF_THUMBNAIL,
    "video/mp4": GENERATE_VIDEO_THUMBNAIL,
    "video/webm": GENERATE_VIDEO_THUMBNAIL,
    "video/quicktime": GENERATE_VIDEO_THUMBNAIL,
    "video/x-msvideo": GENERATE_VIDEO_THUMBNAIL,
    "video/x-matroska": GENERATE_VIDEO_THUMBNAIL,
    "video/mpeg": GENERATE_VIDEO_THUMBNAIL,
    "video/ogg": GENERATE_VIDEO_THUMBNAIL,
}

# WebM ships from MediaRecorder but macOS Finder, iOS Files/Photos, AirDrop
# previews, and older Slack clients refuse it. Transcoding fans out alongside
# the thumbnail job for `video/webm`.
TRANSCODE_MIME_TYPES: dict[str, JobRef] = {
    "video/webm": TRANSCODE_VIDEO_TO_MP4,
}

EXTRACTION_MIME_TYPES: dict[str, JobRef] = {
    "image/jpeg": EXTRACT_IMAGE_METADATA,
    "image/png": EXTRACT_IMAGE_METADATA,
    "image/gif": EXTRACT_IMAGE_METADATA,
    "image/webp": EXTRACT_IMAGE_METADATA,
    "image/bmp": EXTRACT_IMAGE_METADATA,
    "image/tiff": EXTRACT_IMAGE_METADATA,
    "audio/mpeg": EXTRACT_AUDIO_METADATA,
    "audio/wav": EXTRACT_AUDIO_METADATA,
    "audio/x-wav": EXTRACT_AUDIO_METADATA,
    "audio/flac": EXTRACT_AUDIO_METADATA,
    "audio/x-flac": EXTRACT_AUDIO_METADATA,
    "audio/aac": EXTRACT_AUDIO_METADATA,
    "audio/ogg": EXTRACT_AUDIO_METADATA,
    "audio/mp4": EXTRACT_AUDIO_METADATA,
    "audio/x-m4a": EXTRACT_AUDIO_METADATA,
    "audio/opus": EXTRACT_AUDIO_METADATA,
    "audio/webm": EXTRACT_AUDIO_METADATA,
    "application/pdf": EXTRACT_DOCUMENT_CONTENT,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (
        EXTRACT_DOCUMENT_CONTENT
    ),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": (EXTRACT_DOCUMENT_CONTENT),
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": (
        EXTRACT_DOCUMENT_CONTENT
    ),
    "text/html": EXTRACT_DOCUMENT_CONTENT,
    "application/rtf": EXTRACT_DOCUMENT_CONTENT,
    "text/rtf": EXTRACT_DOCUMENT_CONTENT,
    "text/csv": EXTRACT_DOCUMENT_CONTENT,
    "text/tab-separated-values": EXTRACT_DOCUMENT_CONTENT,
    "text/plain": EXTRACT_DOCUMENT_CONTENT,
    "text/markdown": EXTRACT_DOCUMENT_CONTENT,
    "application/json": EXTRACT_DOCUMENT_CONTENT,
    "application/xml": EXTRACT_DOCUMENT_CONTENT,
}


def _base_mime_type(mime_type: str) -> str:
    """Strip codec parameters (e.g. `audio/webm;codecs=opus` -> `audio/webm`)."""
    return mime_type.split(";")[0].strip()


def get_jobs_for_mime_type(mime_type: str) -> list[JobRef]:
    """Return jobs to enqueue for `mime_type`, in processing order (thumb, transcode, extract)."""
    base = _base_mime_type(mime_type)
    jobs = []

    if base in THUMBNAIL_MIME_TYPES:
        jobs.append(THUMBNAIL_MIME_TYPES[base])

    if base in TRANSCODE_MIME_TYPES:
        jobs.append(TRANSCODE_MIME_TYPES[base])

    if base in EXTRACTION_MIME_TYPES:
        jobs.append(EXTRACTION_MIME_TYPES[base])

    return jobs


def supports_thumbnail(mime_type: str) -> bool:
    return _base_mime_type(mime_type) in THUMBNAIL_MIME_TYPES


def supports_extraction(mime_type: str) -> bool:
    return _base_mime_type(mime_type) in EXTRACTION_MIME_TYPES
