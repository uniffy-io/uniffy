"""Task collections registered on the core and egress worker fleets."""

from uniffy.domains.chat.read_state.flush import flush_chat_read_cursors
from uniffy.workers.tasks import JobName
from uniffy.workers.tasks.agent_chat import respond_to_chat_message
from uniffy.workers.tasks.agent_compaction import compact_session
from uniffy.workers.tasks.agent_cron import (
    execute_agent_cron_tasks,
    execute_single_agent_cron_task,
)
from uniffy.workers.tasks.agent_run import delete_run_stream, run_agent_session
from uniffy.workers.tasks.agent_skill_analysis import analyze_session_for_skills
from uniffy.workers.tasks.audit_partitions import provision_audit_partitions
from uniffy.workers.tasks.base import (
    core_on_shutdown,
    core_on_startup,
    egress_on_shutdown,
    egress_on_startup,
    on_job_end,
    on_job_start,
)
from uniffy.workers.tasks.calls import cleanup_orphan_call_rooms, reconcile_calls
from uniffy.workers.tasks.chat_mute import auto_unmute_channels
from uniffy.workers.tasks.chat_search_acl import (
    flush_chat_search_acl_refreshes,
    refresh_chat_search_acl,
)
from uniffy.workers.tasks.content_extraction import extract_document_content
from uniffy.workers.tasks.directory import sync_identity_source
from uniffy.workers.tasks.extraction import extract_audio_metadata, extract_image_metadata
from uniffy.workers.tasks.mail import send_email
from uniffy.workers.tasks.multipart_reaper import reap_expired_multipart_uploads
from uniffy.workers.tasks.notifications import (
    deliver_push_notification,
    process_notification_event,
    send_email_digest,
)
from uniffy.workers.tasks.permissions_reindex import reindex_org_content_for_defaults
from uniffy.workers.tasks.platform_org_purge import notify_pending_org_purges
from uniffy.workers.tasks.project_search_acl import (
    flush_project_search_acl_refreshes,
    refresh_project_search_acl,
)
from uniffy.workers.tasks.realtime import save_realtime_snapshot
from uniffy.workers.tasks.reminders import check_calendar_reminders
from uniffy.workers.tasks.search_removals import flush_search_removals
from uniffy.workers.tasks.storage_recalculation import recalculate_all_storage_usage
from uniffy.workers.tasks.support_session_expiry import expire_support_sessions
from uniffy.workers.tasks.tags_reindex import reindex_tag_doc, reindex_tag_urns
from uniffy.workers.tasks.task_reminders import check_task_due_dates
from uniffy.workers.tasks.thumbnails import (
    generate_image_thumbnail,
    generate_pdf_thumbnail,
    generate_video_thumbnail,
)
from uniffy.workers.tasks.video_transcode import (
    delete_s3_object,
    transcode_video_to_mp4,
)

CORE_TASKS = (
    generate_image_thumbnail,
    generate_pdf_thumbnail,
    generate_video_thumbnail,
    transcode_video_to_mp4,
    delete_s3_object,
    extract_image_metadata,
    extract_audio_metadata,
    extract_document_content,
    process_notification_event,
    deliver_push_notification,
    send_email,
    send_email_digest,
    reindex_tag_urns,
    reindex_tag_doc,
    reap_expired_multipart_uploads,
    reindex_org_content_for_defaults,
    save_realtime_snapshot,
    flush_search_removals,
    refresh_chat_search_acl,
    refresh_project_search_acl,
)

EGRESS_TASKS = (
    respond_to_chat_message,
    compact_session,
    analyze_session_for_skills,
    execute_single_agent_cron_task,
    run_agent_session,
    delete_run_stream,
    sync_identity_source,
)

_registered_job_names = {task.__name__ for task in (*CORE_TASKS, *EGRESS_TASKS)}
_catalogued_job_names = {job_name.value for job_name in JobName}
if _registered_job_names != _catalogued_job_names:
    missing = sorted(_registered_job_names - _catalogued_job_names)
    stale = sorted(_catalogued_job_names - _registered_job_names)
    raise RuntimeError(f"ARQ job-name catalog drift: missing={missing}, stale={stale}")

__all__ = [
    "CORE_TASKS",
    "EGRESS_TASKS",
    "analyze_session_for_skills",
    "auto_unmute_channels",
    "check_calendar_reminders",
    "check_task_due_dates",
    "cleanup_orphan_call_rooms",
    "compact_session",
    "core_on_shutdown",
    "core_on_startup",
    "delete_run_stream",
    "delete_s3_object",
    "deliver_push_notification",
    "egress_on_shutdown",
    "egress_on_startup",
    "execute_agent_cron_tasks",
    "execute_single_agent_cron_task",
    "expire_support_sessions",
    "extract_audio_metadata",
    "extract_document_content",
    "extract_image_metadata",
    "flush_chat_read_cursors",
    "flush_chat_search_acl_refreshes",
    "flush_project_search_acl_refreshes",
    "flush_search_removals",
    "generate_image_thumbnail",
    "generate_pdf_thumbnail",
    "generate_video_thumbnail",
    "notify_pending_org_purges",
    "on_job_end",
    "on_job_start",
    "process_notification_event",
    "provision_audit_partitions",
    "reap_expired_multipart_uploads",
    "recalculate_all_storage_usage",
    "reconcile_calls",
    "reindex_org_content_for_defaults",
    "refresh_chat_search_acl",
    "refresh_project_search_acl",
    "reindex_tag_doc",
    "reindex_tag_urns",
    "respond_to_chat_message",
    "run_agent_session",
    "save_realtime_snapshot",
    "send_email",
    "send_email_digest",
    "sync_identity_source",
    "transcode_video_to_mp4",
]
