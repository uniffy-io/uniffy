"""
MIME type utilities for job routing.

Maps MIME types to the appropriate background jobs for
thumbnail generation and metadata extraction.
"""

# MIME types that support thumbnail generation
THUMBNAIL_MIME_TYPES: dict[str, str] = {
    # Images (using Pillow)
    "image/jpeg": "generate_image_thumbnail",
    "image/png": "generate_image_thumbnail",
    "image/gif": "generate_image_thumbnail",
    "image/webp": "generate_image_thumbnail",
    "image/bmp": "generate_image_thumbnail",
    "image/tiff": "generate_image_thumbnail",
    # PDFs (using PyMuPDF)
    "application/pdf": "generate_pdf_thumbnail",
    # Videos (using ffmpeg)
    "video/mp4": "generate_video_thumbnail",
    "video/webm": "generate_video_thumbnail",
    "video/quicktime": "generate_video_thumbnail",
    "video/x-msvideo": "generate_video_thumbnail",
    "video/x-matroska": "generate_video_thumbnail",
    "video/mpeg": "generate_video_thumbnail",
    "video/ogg": "generate_video_thumbnail",
}

# MIME types that support metadata extraction
EXTRACTION_MIME_TYPES: dict[str, str] = {
    # Images (EXIF, dimensions)
    "image/jpeg": "extract_image_metadata",
    "image/png": "extract_image_metadata",
    "image/gif": "extract_image_metadata",
    "image/webp": "extract_image_metadata",
    "image/bmp": "extract_image_metadata",
    "image/tiff": "extract_image_metadata",
    # Audio (metadata + album art thumbnail)
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
}


def get_jobs_for_mime_type(mime_type: str) -> list[str]:
    """
    Get list of job names to run for a MIME type.

    Returns thumbnail job first, then extraction job.
    Jobs are returned in processing order.

    Parameters
    ----------
    mime_type : str
        The MIME type of the file.

    Returns
    -------
    list[str]
        List of job function names to enqueue.

    """
    jobs = []

    if mime_type in THUMBNAIL_MIME_TYPES:
        jobs.append(THUMBNAIL_MIME_TYPES[mime_type])

    if mime_type in EXTRACTION_MIME_TYPES:
        jobs.append(EXTRACTION_MIME_TYPES[mime_type])

    return jobs


def supports_thumbnail(mime_type: str) -> bool:
    """
    Check if MIME type supports thumbnail generation.

    Parameters
    ----------
    mime_type : str
        The MIME type to check.

    Returns
    -------
    bool
        True if thumbnails can be generated for this type.

    """
    return mime_type in THUMBNAIL_MIME_TYPES


def supports_extraction(mime_type: str) -> bool:
    """
    Check if MIME type supports metadata extraction.

    Parameters
    ----------
    mime_type : str
        The MIME type to check.

    Returns
    -------
    bool
        True if metadata can be extracted from this type.

    """
    return mime_type in EXTRACTION_MIME_TYPES


def get_processable_mime_types() -> set[str]:
    """
    Get all MIME types that have any background processing.

    Returns
    -------
    set[str]
        Set of MIME types that support thumbnails or extraction.

    """
    return set(THUMBNAIL_MIME_TYPES.keys()) | set(EXTRACTION_MIME_TYPES.keys())
