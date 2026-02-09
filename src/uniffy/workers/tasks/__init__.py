"""Background task implementations."""

from uniffy.workers.tasks.base import on_job_end, on_job_start, on_shutdown, on_startup
from uniffy.workers.tasks.extraction import extract_audio_metadata, extract_image_metadata
from uniffy.workers.tasks.notifications import (
    deliver_email_notification,
    deliver_push_notification,
    process_notification_event,
    send_email_digest,
)
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
    "extract_audio_metadata",
    # Notifications
    "process_notification_event",
    "deliver_push_notification",
    "deliver_email_notification",
    "send_email_digest",
]
