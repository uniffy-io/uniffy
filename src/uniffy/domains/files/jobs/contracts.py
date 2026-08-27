"""Producer-facing file background-job contracts."""

from uniffy.core.jobs import JobRecovery, JobRef, JobReliability, JobWorkload
from uniffy.core.valkey.queue import QueueName

GENERATE_IMAGE_THUMBNAIL = JobRef(
    name="generate_image_thumbnail",
    queue=QueueName.CORE,
    workload=JobWorkload.MEDIA,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="files_files thumbnail_status=PENDING row",
        trigger="file-processing recovery schedule",
    ),
)
GENERATE_PDF_THUMBNAIL = JobRef(
    name="generate_pdf_thumbnail",
    queue=QueueName.CORE,
    workload=JobWorkload.MEDIA,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="files_files thumbnail_status=PENDING row",
        trigger="file-processing recovery schedule",
    ),
)
GENERATE_VIDEO_THUMBNAIL = JobRef(
    name="generate_video_thumbnail",
    queue=QueueName.CORE,
    workload=JobWorkload.MEDIA,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="files_files thumbnail_status=PENDING row",
        trigger="file-processing recovery schedule",
    ),
)
TRANSCODE_VIDEO_TO_MP4 = JobRef(
    name="transcode_video_to_mp4",
    queue=QueueName.CORE,
    workload=JobWorkload.MEDIA,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="files_files transcode_status=PENDING row",
        trigger="file-processing recovery schedule",
    ),
)
DELETE_S3_OBJECT = JobRef(
    name="delete_s3_object",
    queue=QueueName.CORE,
    workload=JobWorkload.MEDIA,
    reliability=JobReliability.BEST_EFFORT,
)
EXTRACT_IMAGE_METADATA = JobRef(
    name="extract_image_metadata",
    queue=QueueName.CORE,
    workload=JobWorkload.MEDIA,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="files_files extraction_status=PENDING row",
        trigger="file-processing recovery schedule",
    ),
)
EXTRACT_AUDIO_METADATA = JobRef(
    name="extract_audio_metadata",
    queue=QueueName.CORE,
    workload=JobWorkload.MEDIA,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="files_files extraction_status=PENDING row",
        trigger="file-processing recovery schedule",
    ),
)
EXTRACT_DOCUMENT_CONTENT = JobRef(
    name="extract_document_content",
    queue=QueueName.CORE,
    workload=JobWorkload.MEDIA,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="files_files extraction_status=PENDING row",
        trigger="file-processing recovery schedule",
    ),
)
REAP_EXPIRED_MULTIPART_UPLOADS = JobRef(
    name="reap_expired_multipart_uploads",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="expired active files_multipart_uploads rows",
        trigger="hourly core schedule",
    ),
)
RECALCULATE_ALL_STORAGE_USAGE_SCHEDULE = JobRef(
    name="cron:recalculate_all_storage_usage",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="files_files rows and storage usage counters",
        trigger="nightly core schedule",
    ),
)
REAP_EXPIRED_MULTIPART_UPLOADS_SCHEDULE = JobRef(
    name="cron:reap_expired_multipart_uploads",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="expired active files_multipart_uploads rows",
        trigger="hourly core schedule",
    ),
)
RECOVER_PENDING_FILE_PROCESSING_SCHEDULE = JobRef(
    name="cron:recover_pending_file_processing",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="stale files_files thumbnail, extraction, or transcode pending/processing rows",
        trigger="five-minute core schedule",
    ),
)

FILE_JOB_REFS = (
    GENERATE_IMAGE_THUMBNAIL,
    GENERATE_PDF_THUMBNAIL,
    GENERATE_VIDEO_THUMBNAIL,
    TRANSCODE_VIDEO_TO_MP4,
    DELETE_S3_OBJECT,
    EXTRACT_IMAGE_METADATA,
    EXTRACT_AUDIO_METADATA,
    EXTRACT_DOCUMENT_CONTENT,
    REAP_EXPIRED_MULTIPART_UPLOADS,
)
FILE_SCHEDULED_JOB_REFS = (
    RECALCULATE_ALL_STORAGE_USAGE_SCHEDULE,
    REAP_EXPIRED_MULTIPART_UPLOADS_SCHEDULE,
    RECOVER_PENDING_FILE_PROCESSING_SCHEDULE,
)
