"""MIME type to background-job mapping for thumbnails, transcode, and extraction."""

THUMBNAIL_MIME_TYPES: dict[str, str] = {
    "image/jpeg": "generate_image_thumbnail",
    "image/png": "generate_image_thumbnail",
    "image/gif": "generate_image_thumbnail",
    "image/webp": "generate_image_thumbnail",
    "image/bmp": "generate_image_thumbnail",
    "image/tiff": "generate_image_thumbnail",
    "application/pdf": "generate_pdf_thumbnail",
    "video/mp4": "generate_video_thumbnail",
    "video/webm": "generate_video_thumbnail",
    "video/quicktime": "generate_video_thumbnail",
    "video/x-msvideo": "generate_video_thumbnail",
    "video/x-matroska": "generate_video_thumbnail",
    "video/mpeg": "generate_video_thumbnail",
    "video/ogg": "generate_video_thumbnail",
}

# WebM ships from MediaRecorder but macOS Finder, iOS Files/Photos, AirDrop
# previews, and older Slack clients refuse it. Transcoding fans out alongside
# the thumbnail job for `video/webm`.
TRANSCODE_MIME_TYPES: dict[str, str] = {
    "video/webm": "transcode_video_to_mp4",
}

EXTRACTION_MIME_TYPES: dict[str, str] = {
    "image/jpeg": "extract_image_metadata",
    "image/png": "extract_image_metadata",
    "image/gif": "extract_image_metadata",
    "image/webp": "extract_image_metadata",
    "image/bmp": "extract_image_metadata",
    "image/tiff": "extract_image_metadata",
    "audio/mpeg": "extract_audio_metadata",
    "audio/wav": "extract_audio_metadata",
    "audio/x-wav": "extract_audio_metadata",
    "audio/flac": "extract_audio_metadata",
    "audio/x-flac": "extract_audio_metadata",
    "audio/aac": "extract_audio_metadata",
    "audio/ogg": "extract_audio_metadata",
    "audio/mp4": "extract_audio_metadata",
    "audio/x-m4a": "extract_audio_metadata",
    "audio/opus": "extract_audio_metadata",
    "audio/webm": "extract_audio_metadata",
    "application/pdf": "extract_document_content",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (
        "extract_document_content"
    ),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": (
        "extract_document_content"
    ),
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": (
        "extract_document_content"
    ),
    "text/html": "extract_document_content",
    "application/rtf": "extract_document_content",
    "text/rtf": "extract_document_content",
    "text/csv": "extract_document_content",
    "text/tab-separated-values": "extract_document_content",
    "text/plain": "extract_document_content",
    "text/markdown": "extract_document_content",
    "application/json": "extract_document_content",
    "application/xml": "extract_document_content",
}


def _base_mime_type(mime_type: str) -> str:
    """Strip codec parameters (e.g. `audio/webm;codecs=opus` -> `audio/webm`)."""
    return mime_type.split(";")[0].strip()


def get_jobs_for_mime_type(mime_type: str) -> list[str]:
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
