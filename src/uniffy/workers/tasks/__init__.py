"""Background task implementations."""

from uniffy.workers.tasks.base import on_job_end, on_job_start, on_shutdown, on_startup
from uniffy.workers.tasks.extraction import extract_image_metadata
from uniffy.workers.tasks.thumbnails import (
    generate_image_thumbnail,
    generate_pdf_thumbnail,
    generate_video_thumbnail,
)

__all__ = [
    # Lifecycle hooks
    "on_startup",
    "on_shutdown",
    "on_job_start",
    "on_job_end",
    # Thumbnails
    "generate_image_thumbnail",
    "generate_pdf_thumbnail",
    "generate_video_thumbnail",
    # Extraction
    "extract_image_metadata",
]
