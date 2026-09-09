"""Validate domain handlers and build definitions for both worker fleets."""

from typing import Any

from uniffy.core.events.job_contracts import (
    EVENT_JOB_REFS,
    EVENT_SCHEDULED_JOB_REFS,
    PROCESS_NOTIFICATION_EVENT,
)
from uniffy.core.jobs import JobRef, QueueName
from uniffy.core.realtime.job_contracts import (
    REALTIME_JOB_REFS,
    REALTIME_SCHEDULED_JOB_REFS,
    SAVE_REALTIME_SNAPSHOT,
)
from uniffy.core.realtime.jobs import save_realtime_snapshot
from uniffy.domains.agents.bridge.jobs.contracts import (
    CHAT_INTEGRATION_JOB_REFS,
    CHAT_INTEGRATION_SCHEDULED_JOB_REFS,
    RESPOND_TO_CHAT_MESSAGE,
)
from uniffy.domains.agents.bridge.jobs.jobs import respond_to_chat_message
from uniffy.domains.agents.cron.jobs.contracts import (
    CRON_JOB_REFS,
    CRON_SCHEDULED_JOB_REFS,
    EXECUTE_AGENT_CRON_TASKS_SCHEDULE,
    EXECUTE_SINGLE_AGENT_CRON_TASK,
)
from uniffy.domains.agents.cron.jobs.jobs import (
    execute_agent_cron_tasks,
    execute_single_agent_cron_task,
)
from uniffy.domains.agents.runtime.jobs.contracts import (
    DELETE_RUN_STREAM,
    RUN_AGENT_SESSION,
    RUNTIME_JOB_REFS,
    RUNTIME_SCHEDULED_JOB_REFS,
)
from uniffy.domains.agents.runtime.jobs.jobs import (
    RUN_AGENT_SESSION_JOB_TIMEOUT_SECONDS,
    delete_run_stream,
    run_agent_session,
)
from uniffy.domains.agents.sessions.jobs.contracts import (
    COMPACT_SESSION,
    SESSION_JOB_REFS,
    SESSION_SCHEDULED_JOB_REFS,
)
from uniffy.domains.agents.sessions.jobs.jobs import (
    COMPACT_SESSION_JOB_TIMEOUT_SECONDS,
    compact_session,
)
from uniffy.domains.agents.skills.generation import GENERATION_TIMEOUT_SECONDS
from uniffy.domains.agents.skills.jobs.contracts import (
    EXPIRE_SKILL_DRAFT_GENERATIONS_SCHEDULE,
    GENERATE_SKILL_DRAFT,
    SKILL_JOB_REFS,
    SKILL_SCHEDULED_JOB_REFS,
)
from uniffy.domains.agents.skills.jobs.jobs import (
    expire_skill_draft_generations,
    generate_skill_draft,
)
from uniffy.domains.audit.jobs.contracts import (
    AUDIT_JOB_REFS,
    AUDIT_SCHEDULED_JOB_REFS,
    PROVISION_AUDIT_PARTITIONS_SCHEDULE,
)
from uniffy.domains.audit.jobs.jobs import (
    PROVISION_AUDIT_PARTITIONS_JOB_TIMEOUT_SECONDS,
    provision_audit_partitions,
)
from uniffy.domains.calls.jobs.contracts import (
    CALLS_JOB_REFS,
    CALLS_SCHEDULED_JOB_REFS,
    CLEANUP_ORPHAN_CALL_ROOMS_SCHEDULE,
    RECONCILE_CALLS_SCHEDULE,
)
from uniffy.domains.calls.jobs.jobs import (
    CALL_MAINTENANCE_JOB_TIMEOUT_SECONDS,
    cleanup_orphan_call_rooms,
    reconcile_calls,
)
from uniffy.domains.chat.jobs.contracts import (
    AUTO_UNMUTE_CHANNELS_SCHEDULE,
    CHAT_JOB_REFS,
    CHAT_SCHEDULED_JOB_REFS,
    FLUSH_CHAT_READ_CURSORS_SCHEDULE,
    FLUSH_CHAT_SEARCH_ACL_REFRESHES_SCHEDULE,
    POST_SEND_CHAT_MESSAGE,
    REFRESH_CHAT_SEARCH_ACL,
)
from uniffy.domains.chat.jobs.jobs import (
    auto_unmute_channels,
    flush_chat_search_acl_refreshes,
    post_send_chat_message,
    refresh_chat_search_acl,
)
from uniffy.domains.chat.reads.flush import flush_chat_read_cursors
from uniffy.domains.directory.sync.jobs.contracts import (
    DIRECTORY_JOB_REFS,
    DIRECTORY_SCHEDULED_JOB_REFS,
    SYNC_IDENTITY_SOURCE,
)
from uniffy.domains.directory.sync.jobs.jobs import (
    SYNC_IDENTITY_SOURCE_JOB_TIMEOUT_SECONDS,
    sync_identity_source,
)
from uniffy.domains.files.jobs.content import extract_document_content
from uniffy.domains.files.jobs.contracts import (
    DELETE_S3_OBJECT,
    EXTRACT_AUDIO_METADATA,
    EXTRACT_DOCUMENT_CONTENT,
    EXTRACT_IMAGE_METADATA,
    FILE_JOB_REFS,
    FILE_SCHEDULED_JOB_REFS,
    GENERATE_IMAGE_THUMBNAIL,
    GENERATE_PDF_THUMBNAIL,
    GENERATE_VIDEO_THUMBNAIL,
    REAP_EXPIRED_MULTIPART_UPLOADS,
    REAP_EXPIRED_MULTIPART_UPLOADS_SCHEDULE,
    RECALCULATE_ALL_STORAGE_USAGE_SCHEDULE,
    RECOVER_PENDING_FILE_PROCESSING_SCHEDULE,
    TRANSCODE_VIDEO_TO_MP4,
)
from uniffy.domains.files.jobs.jobs import recover_pending_file_processing
from uniffy.domains.files.jobs.metadata import extract_audio_metadata, extract_image_metadata
from uniffy.domains.files.jobs.multipart import (
    REAP_MULTIPART_UPLOADS_JOB_TIMEOUT_SECONDS,
    reap_expired_multipart_uploads,
)
from uniffy.domains.files.jobs.quota import recalculate_all_storage_usage
from uniffy.domains.files.jobs.thumbnails import (
    generate_image_thumbnail,
    generate_pdf_thumbnail,
    generate_video_thumbnail,
)
from uniffy.domains.files.jobs.transcode import (
    TRANSCODE_JOB_TIMEOUT_SECONDS,
    delete_s3_object,
    transcode_video_to_mp4,
)
from uniffy.domains.mail.jobs.contracts import MAIL_JOB_REFS, MAIL_SCHEDULED_JOB_REFS, SEND_EMAIL
from uniffy.domains.mail.jobs.jobs import send_email
from uniffy.domains.notifications.jobs.contracts import (
    DELIVER_PUSH_NOTIFICATION,
    DISPATCH_NOTIFICATION_EMAILS,
    DISPATCH_NOTIFICATION_EMAILS_SCHEDULE,
    NOTIFICATION_JOB_REFS,
    NOTIFICATION_SCHEDULED_JOB_REFS,
    SEND_NOTIFICATION_DIGEST,
    SEND_NOTIFICATION_EMAIL,
)
from uniffy.domains.notifications.jobs.email import (
    dispatch_notification_emails,
    send_notification_digest,
    send_notification_email,
)
from uniffy.domains.notifications.jobs.jobs import (
    deliver_push_notification,
    process_notification_event,
)
from uniffy.domains.permissions.jobs.contracts import (
    PERMISSION_JOB_REFS,
    PERMISSION_SCHEDULED_JOB_REFS,
    REINDEX_ORG_CONTENT_FOR_DEFAULTS,
)
from uniffy.domains.permissions.jobs.jobs import reindex_org_content_for_defaults
from uniffy.domains.platform.jobs.contracts import (
    NOTIFY_PENDING_ORG_PURGES_SCHEDULE,
    PLATFORM_JOB_REFS,
    PLATFORM_SCHEDULED_JOB_REFS,
)
from uniffy.domains.platform.jobs.jobs import (
    NOTIFY_PENDING_ORG_PURGES_JOB_TIMEOUT_SECONDS,
    notify_pending_org_purges,
)
from uniffy.domains.platform.support.jobs.contracts import (
    EXPIRE_SUPPORT_SESSIONS_SCHEDULE,
    SUPPORT_SESSION_JOB_REFS,
    SUPPORT_SESSION_SCHEDULED_JOB_REFS,
)
from uniffy.domains.platform.support.jobs.jobs import (
    EXPIRE_SUPPORT_SESSIONS_JOB_TIMEOUT_SECONDS,
    expire_support_sessions,
)
from uniffy.domains.projects.jobs.contracts import (
    CHECK_TASK_DUE_DATES_SCHEDULE,
    FLUSH_PROJECT_SEARCH_ACL_REFRESHES_SCHEDULE,
    PROJECT_JOB_REFS,
    PROJECT_SCHEDULED_JOB_REFS,
    REFRESH_PROJECT_SEARCH_ACL,
)
from uniffy.domains.projects.jobs.jobs import (
    check_task_due_dates,
    flush_project_search_acl_refreshes,
    refresh_project_search_acl,
)
from uniffy.domains.scheduling.calendar.jobs.contracts import (
    CALENDAR_JOB_REFS,
    CALENDAR_SCHEDULED_JOB_REFS,
    CHECK_CALENDAR_REMINDERS_SCHEDULE,
)
from uniffy.domains.scheduling.calendar.jobs.jobs import check_calendar_reminders
from uniffy.domains.search.jobs.contracts import (
    FLUSH_SEARCH_REMOVALS,
    FLUSH_SEARCH_REMOVALS_SCHEDULE,
    REINDEX_RENAMED_CONTENT,
    SEARCH_JOB_REFS,
    SEARCH_SCHEDULED_JOB_REFS,
)
from uniffy.domains.search.jobs.jobs import (
    FLUSH_SEARCH_REMOVALS_JOB_TIMEOUT_SECONDS,
    flush_search_removals,
    reindex_renamed_content,
)
from uniffy.domains.tags.jobs.contracts import (
    REINDEX_TAG_DOC,
    REINDEX_TAG_URNS,
    TAG_JOB_REFS,
    TAG_SCHEDULED_JOB_REFS,
)
from uniffy.domains.tags.jobs.jobs import reindex_tag_doc, reindex_tag_urns
from uniffy.workers.registration import (
    JobHandler,
    JobRegistration,
    ScheduledJobRegistration,
    build_worker_definitions,
    validate_job_catalogs,
)


def _bind(ref: JobRef, handler: JobHandler, **options: Any) -> JobRegistration:
    return JobRegistration(ref=ref, handler=handler, **options)


def _bind_schedule(
    ref: JobRef,
    handler: JobHandler,
    **schedule: Any,
) -> ScheduledJobRegistration:
    return ScheduledJobRegistration(ref=ref, handler=handler, **schedule)


CORE_JOB_REGISTRATIONS = (
    _bind(GENERATE_IMAGE_THUMBNAIL, generate_image_thumbnail),
    _bind(GENERATE_PDF_THUMBNAIL, generate_pdf_thumbnail),
    _bind(GENERATE_VIDEO_THUMBNAIL, generate_video_thumbnail),
    _bind(
        TRANSCODE_VIDEO_TO_MP4,
        transcode_video_to_mp4,
        timeout=TRANSCODE_JOB_TIMEOUT_SECONDS,
    ),
    _bind(DELETE_S3_OBJECT, delete_s3_object),
    _bind(EXTRACT_IMAGE_METADATA, extract_image_metadata),
    _bind(EXTRACT_AUDIO_METADATA, extract_audio_metadata),
    _bind(EXTRACT_DOCUMENT_CONTENT, extract_document_content),
    _bind(PROCESS_NOTIFICATION_EVENT, process_notification_event),
    _bind(DELIVER_PUSH_NOTIFICATION, deliver_push_notification),
    _bind(SEND_EMAIL, send_email),
    _bind(SEND_NOTIFICATION_EMAIL, send_notification_email),
    _bind(SEND_NOTIFICATION_DIGEST, send_notification_digest),
    _bind(DISPATCH_NOTIFICATION_EMAILS, dispatch_notification_emails),
    _bind(REINDEX_TAG_URNS, reindex_tag_urns),
    _bind(REINDEX_TAG_DOC, reindex_tag_doc),
    _bind(
        REAP_EXPIRED_MULTIPART_UPLOADS,
        reap_expired_multipart_uploads,
        timeout=REAP_MULTIPART_UPLOADS_JOB_TIMEOUT_SECONDS,
    ),
    _bind(REINDEX_ORG_CONTENT_FOR_DEFAULTS, reindex_org_content_for_defaults),
    _bind(SAVE_REALTIME_SNAPSHOT, save_realtime_snapshot),
    _bind(REINDEX_RENAMED_CONTENT, reindex_renamed_content),
    _bind(
        FLUSH_SEARCH_REMOVALS,
        flush_search_removals,
        timeout=FLUSH_SEARCH_REMOVALS_JOB_TIMEOUT_SECONDS,
    ),
    _bind(REFRESH_CHAT_SEARCH_ACL, refresh_chat_search_acl),
    _bind(POST_SEND_CHAT_MESSAGE, post_send_chat_message),
    _bind(REFRESH_PROJECT_SEARCH_ACL, refresh_project_search_acl),
)

EGRESS_JOB_REGISTRATIONS = (
    _bind(
        GENERATE_SKILL_DRAFT,
        generate_skill_draft,
        timeout=GENERATION_TIMEOUT_SECONDS + 30,
        max_tries=1,
    ),
    _bind(RESPOND_TO_CHAT_MESSAGE, respond_to_chat_message),
    _bind(
        COMPACT_SESSION,
        compact_session,
        timeout=COMPACT_SESSION_JOB_TIMEOUT_SECONDS,
    ),
    _bind(EXECUTE_SINGLE_AGENT_CRON_TASK, execute_single_agent_cron_task),
    _bind(
        RUN_AGENT_SESSION,
        run_agent_session,
        timeout=RUN_AGENT_SESSION_JOB_TIMEOUT_SECONDS,
    ),
    _bind(DELETE_RUN_STREAM, delete_run_stream),
    _bind(
        SYNC_IDENTITY_SOURCE,
        sync_identity_source,
        timeout=SYNC_IDENTITY_SOURCE_JOB_TIMEOUT_SECONDS,
    ),
)

CORE_SCHEDULED_REGISTRATIONS = (
    _bind_schedule(EXPIRE_SKILL_DRAFT_GENERATIONS_SCHEDULE, expire_skill_draft_generations),
    _bind_schedule(
        CHECK_CALENDAR_REMINDERS_SCHEDULE,
        check_calendar_reminders,
    ),
    _bind_schedule(
        CHECK_TASK_DUE_DATES_SCHEDULE,
        check_task_due_dates,
    ),
    _bind_schedule(
        DISPATCH_NOTIFICATION_EMAILS_SCHEDULE,
        dispatch_notification_emails,
        second=(10,),
    ),
    _bind_schedule(
        FLUSH_CHAT_READ_CURSORS_SCHEDULE,
        flush_chat_read_cursors,
        second=(0, 30),
    ),
    _bind_schedule(
        FLUSH_CHAT_SEARCH_ACL_REFRESHES_SCHEDULE,
        flush_chat_search_acl_refreshes,
        second=(15,),
    ),
    _bind_schedule(
        FLUSH_PROJECT_SEARCH_ACL_REFRESHES_SCHEDULE,
        flush_project_search_acl_refreshes,
        second=(25,),
    ),
    _bind_schedule(
        AUTO_UNMUTE_CHANNELS_SCHEDULE,
        auto_unmute_channels,
        second=(0,),
    ),
    _bind_schedule(
        RECALCULATE_ALL_STORAGE_USAGE_SCHEDULE,
        recalculate_all_storage_usage,
        hour=3,
        minute=0,
    ),
    _bind_schedule(
        REAP_EXPIRED_MULTIPART_UPLOADS_SCHEDULE,
        reap_expired_multipart_uploads,
        minute=(0,),
        timeout=REAP_MULTIPART_UPLOADS_JOB_TIMEOUT_SECONDS,
    ),
    _bind_schedule(
        RECOVER_PENDING_FILE_PROCESSING_SCHEDULE,
        recover_pending_file_processing,
        minute=(1, 6, 11, 16, 21, 26, 31, 36, 41, 46, 51, 56),
    ),
    _bind_schedule(
        NOTIFY_PENDING_ORG_PURGES_SCHEDULE,
        notify_pending_org_purges,
        hour=2,
        minute=15,
        timeout=NOTIFY_PENDING_ORG_PURGES_JOB_TIMEOUT_SECONDS,
    ),
    _bind_schedule(
        EXPIRE_SUPPORT_SESSIONS_SCHEDULE,
        expire_support_sessions,
        timeout=EXPIRE_SUPPORT_SESSIONS_JOB_TIMEOUT_SECONDS,
    ),
    _bind_schedule(
        RECONCILE_CALLS_SCHEDULE,
        reconcile_calls,
        minute=(0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55),
        timeout=CALL_MAINTENANCE_JOB_TIMEOUT_SECONDS,
    ),
    _bind_schedule(
        CLEANUP_ORPHAN_CALL_ROOMS_SCHEDULE,
        cleanup_orphan_call_rooms,
        minute=(30,),
        timeout=CALL_MAINTENANCE_JOB_TIMEOUT_SECONDS,
    ),
    _bind_schedule(
        FLUSH_SEARCH_REMOVALS_SCHEDULE,
        flush_search_removals,
        minute=(2, 7, 12, 17, 22, 27, 32, 37, 42, 47, 52, 57),
        timeout=FLUSH_SEARCH_REMOVALS_JOB_TIMEOUT_SECONDS,
    ),
    _bind_schedule(
        PROVISION_AUDIT_PARTITIONS_SCHEDULE,
        provision_audit_partitions,
        hour=1,
        minute=7,
        timeout=PROVISION_AUDIT_PARTITIONS_JOB_TIMEOUT_SECONDS,
    ),
)

EGRESS_SCHEDULED_REGISTRATIONS = (
    _bind_schedule(
        EXECUTE_AGENT_CRON_TASKS_SCHEDULE,
        execute_agent_cron_tasks,
    ),
)

_JOB_REFS = (
    *EVENT_JOB_REFS,
    *CHAT_INTEGRATION_JOB_REFS,
    *CRON_JOB_REFS,
    *RUNTIME_JOB_REFS,
    *SESSION_JOB_REFS,
    *SKILL_JOB_REFS,
    *AUDIT_JOB_REFS,
    *CALENDAR_JOB_REFS,
    *CALLS_JOB_REFS,
    *CHAT_JOB_REFS,
    *FILE_JOB_REFS,
    *MAIL_JOB_REFS,
    *NOTIFICATION_JOB_REFS,
    *DIRECTORY_JOB_REFS,
    *PERMISSION_JOB_REFS,
    *PLATFORM_JOB_REFS,
    *SUPPORT_SESSION_JOB_REFS,
    *PROJECT_JOB_REFS,
    *REALTIME_JOB_REFS,
    *SEARCH_JOB_REFS,
    *TAG_JOB_REFS,
)
_SCHEDULED_JOB_REFS = (
    *EVENT_SCHEDULED_JOB_REFS,
    *CHAT_INTEGRATION_SCHEDULED_JOB_REFS,
    *CRON_SCHEDULED_JOB_REFS,
    *RUNTIME_SCHEDULED_JOB_REFS,
    *SESSION_SCHEDULED_JOB_REFS,
    *SKILL_SCHEDULED_JOB_REFS,
    *AUDIT_SCHEDULED_JOB_REFS,
    *CALENDAR_SCHEDULED_JOB_REFS,
    *CALLS_SCHEDULED_JOB_REFS,
    *CHAT_SCHEDULED_JOB_REFS,
    *FILE_SCHEDULED_JOB_REFS,
    *MAIL_SCHEDULED_JOB_REFS,
    *NOTIFICATION_SCHEDULED_JOB_REFS,
    *DIRECTORY_SCHEDULED_JOB_REFS,
    *PERMISSION_SCHEDULED_JOB_REFS,
    *PLATFORM_SCHEDULED_JOB_REFS,
    *SUPPORT_SESSION_SCHEDULED_JOB_REFS,
    *PROJECT_SCHEDULED_JOB_REFS,
    *REALTIME_SCHEDULED_JOB_REFS,
    *SEARCH_SCHEDULED_JOB_REFS,
    *TAG_SCHEDULED_JOB_REFS,
)

validate_job_catalogs(
    (*CORE_JOB_REGISTRATIONS, *EGRESS_JOB_REGISTRATIONS),
    (*CORE_SCHEDULED_REGISTRATIONS, *EGRESS_SCHEDULED_REGISTRATIONS),
    _JOB_REFS,
    _SCHEDULED_JOB_REFS,
)

_core_definitions = build_worker_definitions(
    QueueName.CORE,
    CORE_JOB_REGISTRATIONS,
    CORE_SCHEDULED_REGISTRATIONS,
)
_egress_definitions = build_worker_definitions(
    QueueName.EGRESS,
    EGRESS_JOB_REGISTRATIONS,
    EGRESS_SCHEDULED_REGISTRATIONS,
)

CORE_JOBS = _core_definitions.functions
CORE_CRON_JOBS = _core_definitions.cron_jobs
EGRESS_JOBS = _egress_definitions.functions
EGRESS_CRON_JOBS = _egress_definitions.cron_jobs

__all__ = [
    "CORE_CRON_JOBS",
    "CORE_JOBS",
    "CORE_JOB_REGISTRATIONS",
    "CORE_SCHEDULED_REGISTRATIONS",
    "EGRESS_CRON_JOBS",
    "EGRESS_JOBS",
    "EGRESS_JOB_REGISTRATIONS",
    "EGRESS_SCHEDULED_REGISTRATIONS",
]
