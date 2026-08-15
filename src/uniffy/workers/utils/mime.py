"""MIME type to background-job mapping for thumbnails, transcode, and extraction."""

from uniffy.workers.tasks import JobName

THUMBNAIL_MIME_TYPES: dict[str, JobName] = {
    "image/jpeg": JobName.GENERATE_IMAGE_THUMBNAIL,
    "image/png": JobName.GENERATE_IMAGE_THUMBNAIL,
    "image/gif": JobName.GENERATE_IMAGE_THUMBNAIL,
    "image/webp": JobName.GENERATE_IMAGE_THUMBNAIL,
    "image/bmp": JobName.GENERATE_IMAGE_THUMBNAIL,
    "image/tiff": JobName.GENERATE_IMAGE_THUMBNAIL,
    "application/pdf": JobName.GENERATE_PDF_THUMBNAIL,
    "video/mp4": JobName.GENERATE_VIDEO_THUMBNAIL,
    "video/webm": JobName.GENERATE_VIDEO_THUMBNAIL,
    "video/quicktime": JobName.GENERATE_VIDEO_THUMBNAIL,
    "video/x-msvideo": JobName.GENERATE_VIDEO_THUMBNAIL,
    "video/x-matroska": JobName.GENERATE_VIDEO_THUMBNAIL,
    "video/mpeg": JobName.GENERATE_VIDEO_THUMBNAIL,
    "video/ogg": JobName.GENERATE_VIDEO_THUMBNAIL,
}

# WebM ships from MediaRecorder but macOS Finder, iOS Files/Photos, AirDrop
# previews, and older Slack clients refuse it. Transcoding fans out alongside
# the thumbnail job for `video/webm`.
TRANSCODE_MIME_TYPES: dict[str, JobName] = {
    "video/webm": JobName.TRANSCODE_VIDEO_TO_MP4,
}

EXTRACTION_MIME_TYPES: dict[str, JobName] = {
    "image/jpeg": JobName.EXTRACT_IMAGE_METADATA,
    "image/png": JobName.EXTRACT_IMAGE_METADATA,
    "image/gif": JobName.EXTRACT_IMAGE_METADATA,
    "image/webp": JobName.EXTRACT_IMAGE_METADATA,
    "image/bmp": JobName.EXTRACT_IMAGE_METADATA,
    "image/tiff": JobName.EXTRACT_IMAGE_METADATA,
    "audio/mpeg": JobName.EXTRACT_AUDIO_METADATA,
    "audio/wav": JobName.EXTRACT_AUDIO_METADATA,
    "audio/x-wav": JobName.EXTRACT_AUDIO_METADATA,
    "audio/flac": JobName.EXTRACT_AUDIO_METADATA,
    "audio/x-flac": JobName.EXTRACT_AUDIO_METADATA,
    "audio/aac": JobName.EXTRACT_AUDIO_METADATA,
    "audio/ogg": JobName.EXTRACT_AUDIO_METADATA,
    "audio/mp4": JobName.EXTRACT_AUDIO_METADATA,
    "audio/x-m4a": JobName.EXTRACT_AUDIO_METADATA,
    "audio/opus": JobName.EXTRACT_AUDIO_METADATA,
    "audio/webm": JobName.EXTRACT_AUDIO_METADATA,
    "application/pdf": JobName.EXTRACT_DOCUMENT_CONTENT,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (
        JobName.EXTRACT_DOCUMENT_CONTENT
    ),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": (
        JobName.EXTRACT_DOCUMENT_CONTENT
    ),
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": (
        JobName.EXTRACT_DOCUMENT_CONTENT
    ),
    "text/html": JobName.EXTRACT_DOCUMENT_CONTENT,
    "application/rtf": JobName.EXTRACT_DOCUMENT_CONTENT,
    "text/rtf": JobName.EXTRACT_DOCUMENT_CONTENT,
    "text/csv": JobName.EXTRACT_DOCUMENT_CONTENT,
    "text/tab-separated-values": JobName.EXTRACT_DOCUMENT_CONTENT,
    "text/plain": JobName.EXTRACT_DOCUMENT_CONTENT,
    "text/markdown": JobName.EXTRACT_DOCUMENT_CONTENT,
    "application/json": JobName.EXTRACT_DOCUMENT_CONTENT,
    "application/xml": JobName.EXTRACT_DOCUMENT_CONTENT,
}


def _base_mime_type(mime_type: str) -> str:
    """Strip codec parameters (e.g. `audio/webm;codecs=opus` -> `audio/webm`)."""
    return mime_type.split(";")[0].strip()


def get_jobs_for_mime_type(mime_type: str) -> list[JobName]:
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


def get_processable_mime_types() -> set[str]:
    """Union of all MIME types with thumbnail, transcode, or extraction jobs."""
    return (
        set(THUMBNAIL_MIME_TYPES.keys())
        | set(TRANSCODE_MIME_TYPES.keys())
        | set(EXTRACTION_MIME_TYPES.keys())
    )
